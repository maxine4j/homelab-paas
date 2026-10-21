import type {
	JsonValue,
	ServiceDescriptor,
	UiCluster,
	UiLogs,
	UiResource,
	UiService,
	UiServiceSummary,
} from "@homelab-paas/shared-contracts";

import type { PlatformConfig } from "../config/paas-config.ts";
import type { IGitService } from "../git/git-service.ts";
import type { DescriptorDecoder, IReconciliationStateStore } from "../reconciler/types.ts";
import type { UiDocker } from "./types.ts";

export interface IPaasUiService {
	/** Read-only snapshots. Throws PaasUiError; configuration and known secrets are redacted. */
	getCluster(): Promise<UiCluster>;
	listServices(): Promise<UiServiceSummary[]>;
	getService(serviceId: string): Promise<UiService>;
	getResource(serviceId: string, resourceId: string): Promise<UiResource>;
	/** Only a container belonging to the requested resource may be read. Last 200 lines. */
	getLogs(serviceId: string, resourceId: string, containerId: string): Promise<UiLogs>;
}

export class PaasUiError extends Error {
	constructor(public readonly kind: "not-found" | "unavailable") {
		super(kind === "not-found" ? "Requested item was not found" : "Cluster data is unavailable; retry shortly");
	}
}

export class PaasUiService implements IPaasUiService {
	// The UI has its own Git cache; serialize its fetches to protect FETCH_HEAD.
	private pending: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly config: PlatformConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly docker: UiDocker,
		private readonly state: IReconciliationStateStore,
	) {}

	async getCluster(): Promise<UiCluster> {
		return { clusterId: this.config.metadata.clusterId, config: this.sanitize(this.config, this.secrets()) };
	}

	async listServices(): Promise<UiServiceSummary[]> {
		try {
			return await Promise.all(
				Object.keys(this.config.services)
					.sort()
					.map(async (serviceId) => {
						const state = await this.state.read(serviceId);
						return {
							serviceId,
							phase: state?.phase ?? "unknown",
							desiredRevision: state?.desiredRevision,
							activeRevision: state?.activeRevision,
							failures: state?.failures,
							retryAt: state?.retryAt,
						};
					}),
			);
		} catch {
			throw new PaasUiError("unavailable");
		}
	}

	async getService(serviceId: string): Promise<UiService> {
		this.assertService(serviceId);
		try {
			const [state, containers, file] = await Promise.all([
				this.state.read(serviceId),
				this.docker.listServiceContainers(serviceId),
				this.descriptor(serviceId),
			]);
			const resources = file?.descriptor.resources ?? {};
			const secrets = this.secrets(file?.descriptor);
			const ids = [
				...new Set([...Object.keys(resources), ...containers.map((container) => container.resourceId)]),
			].sort();
			return {
				serviceId,
				phase: state?.phase ?? "unknown",
				desiredRevision: state?.desiredRevision,
				activeRevision: state?.activeRevision,
				failures: state?.failures,
				retryAt: state?.retryAt,
				source: this.sanitize(this.config.services[serviceId], secrets),
				descriptorRevision: file?.revision,
				descriptorStatus: file ? "available" : "unavailable",
				resources: ids.map((resourceId) => ({
					resourceId,
					type: resources[resourceId]?.type ?? "unknown",
					config: resources[resourceId] ? this.sanitize(resources[resourceId], secrets) : undefined,
					containers: containers
						.filter((container) => container.resourceId === resourceId)
						.map((container) => ({
							id: container.id,
							resourceId: container.resourceId,
							imageId: container.imageId,
							state: container.state,
							revision: container.revision,
						})),
				})),
			};
		} catch (error) {
			if (error instanceof PaasUiError) throw error;
			throw new PaasUiError("unavailable");
		}
	}

	async getResource(serviceId: string, resourceId: string): Promise<UiResource> {
		const resource = (await this.getService(serviceId)).resources.find(
			(resource) => resource.resourceId === resourceId,
		);
		if (!resource) throw new PaasUiError("not-found");
		try {
			return {
				...resource,
				containers: await Promise.all(
					resource.containers.map(async (container) => {
						const details = await this.docker.inspectServiceContainer(serviceId, container.id);
						return {
							...container,
							state: details ? container.state : "missing",
							running: details?.running,
							networks: details?.networks,
						};
					}),
				),
			};
		} catch {
			throw new PaasUiError("unavailable");
		}
	}

	async getLogs(serviceId: string, resourceId: string, containerId: string): Promise<UiLogs> {
		this.assertService(serviceId);
		try {
			const containers = await this.docker.listServiceContainers(serviceId, resourceId);
			if (!containers.some((container) => container.id === containerId && container.resourceId === resourceId))
				throw new PaasUiError("not-found");
			const file = await this.descriptor(serviceId);
			if (!file) throw new PaasUiError("unavailable");
			const content = this.redact(
				await this.docker.readServiceContainerLogs(serviceId, containerId),
				this.secrets(file.descriptor),
			);
			return { containerId, content, tail: 200 };
		} catch (error) {
			if (error instanceof PaasUiError) throw error;
			throw new PaasUiError("unavailable");
		}
	}

	private assertService(serviceId: string): void {
		if (!Object.hasOwn(this.config.services, serviceId)) throw new PaasUiError("not-found");
	}

	private descriptor(serviceId: string): Promise<{ revision: string; descriptor: ServiceDescriptor } | undefined> {
		const result = this.pending.then(async () => {
			try {
				const file = await this.git.fetchFile(serviceId, this.config.services[serviceId]!);
				return { revision: file.revision, descriptor: this.decode(file.content, serviceId) };
			} catch {
				return undefined;
			}
		});
		this.pending = result;
		return result;
	}

	private secrets(descriptor?: ServiceDescriptor): string[] {
		const secrets = [
			this.config.auth?.github.clientSecret,
			this.config.auth?.session.signingKey,
			this.config.tls?.dns.credentials.apiToken,
		];
		for (const resource of Object.values(descriptor?.resources ?? {})) {
			if ("env" in resource)
				for (const entry of resource.env ?? []) if ("value" in entry) secrets.push(entry.value);
		}
		return secrets.filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length);
	}

	private redact(value: string, secrets: string[]): string {
		let text = value;
		for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
		return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@");
	}

	private sanitize(value: unknown, secrets: string[], key = ""): JsonValue {
		if (/secret|password|token|signingkey|command|credentials/i.test(key)) return "[redacted]";
		if (typeof value === "string") return this.redact(value, secrets);
		if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
		if (Array.isArray(value)) return value.map((entry) => this.sanitize(entry, secrets));
		if (typeof value === "object")
			return Object.fromEntries(
				Object.entries(value)
					.filter(([, entry]) => entry !== undefined)
					.map(([name, entry]) => [name, this.sanitize(entry, secrets, name)]),
			);
		return null;
	}
}
