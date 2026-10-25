import type {
	ServiceDescriptor,
	UiCluster,
	UiLogs,
	UiResource,
	UiService,
	UiServiceSummary,
	UiServiceEvent,
	UiEditableConfig,
	UiConfigUpdate,
} from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IGitService } from "../git/git-service.ts";
import type { IServiceEventStore } from "../reconciler/service-event-store.ts";
import type { DescriptorDecoder, IReconciliationStateStore } from "../reconciler/types.ts";
import { createLogger } from "../util/logger.ts";
import type { UiDocker } from "./types.ts";

export interface IPaasUiService {
	/** Read-only snapshots. Throws PaasUiError; configuration and known secrets are redacted. */
	getCluster(): Promise<UiCluster>;
	/** Delegates validation, persistence and safe response generation to the configuration service. */
	updateConfig(update: UiConfigUpdate): Promise<UiEditableConfig>;
	listServices(): Promise<UiServiceSummary[]>;
	getService(serviceId: string): Promise<UiService>;
	/** Safe service events, newest first, independent of descriptor/Docker availability. */
	getEvents(serviceId: string): Promise<UiServiceEvent[]>;
	getResource(serviceId: string, resourceId: string): Promise<UiResource>;
	/** Only a container belonging to the requested resource may be read. Last 200 lines. */
	getLogs(serviceId: string, resourceId: string, containerId: string): Promise<UiLogs>;
}

export class PaasUiError extends Error {
	constructor(
		public readonly kind: "not-found" | "unavailable",
		options?: ErrorOptions,
	) {
		super(
			kind === "not-found" ? "Requested item was not found" : "Cluster data is unavailable; retry shortly",
			options,
		);
	}
}

export class PaasUiService implements IPaasUiService {
	private readonly log = createLogger(PaasUiService.name);
	// The UI has its own Git cache; serialize its fetches to protect FETCH_HEAD.
	private pending: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly docker: UiDocker,
		private readonly state: IReconciliationStateStore,
		private readonly events: IServiceEventStore,
	) {}

	async getCluster(): Promise<UiCluster> {
		return {
			clusterId: this.config.getClusterId(),
			...this.config.getEditableConfig(),
		};
	}

	async getEvents(serviceId: string): Promise<UiServiceEvent[]> {
		this.assertService(serviceId);
		try {
			return await this.events.list(serviceId);
		} catch (cause) {
			throw new PaasUiError("unavailable", { cause });
		}
	}

	async updateConfig(update: UiConfigUpdate): Promise<UiEditableConfig> {
		return this.config.updateConfig(update);
	}

	async listServices(): Promise<UiServiceSummary[]> {
		try {
			return await Promise.all(
				Object.keys(this.config.getServices())
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
		} catch (cause) {
			throw new PaasUiError("unavailable", { cause });
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
			const webCount = Object.values(resources).filter((resource) => resource.type === "web").length;
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
				source: this.config.sanitize(this.config.getServices()[serviceId], secrets),
				descriptorRevision: file?.revision,
				descriptorStatus: file ? "available" : "unavailable",
				descriptor: file ? this.config.sanitize(file.descriptor, secrets) : undefined,
				resources: ids.map((resourceId) => ({
					resourceId,
					url:
						resources[resourceId]?.type === "web"
							? this.ingressUrl(`${resourceId}.${serviceId}`)
							: undefined,
					primaryUrl:
						resources[resourceId]?.type === "web"
						&& (webCount === 1 || resources[resourceId].primary === true)
							? this.ingressUrl(serviceId)
							: undefined,
					type: resources[resourceId]?.type ?? "unknown",
					config: resources[resourceId] ? this.config.sanitize(resources[resourceId], secrets) : undefined,
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
			throw new PaasUiError("unavailable", { cause: error });
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
		} catch (cause) {
			throw new PaasUiError("unavailable", { cause });
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
			const content = this.config.redact(
				await this.docker.readServiceContainerLogs(serviceId, containerId),
				this.secrets(file.descriptor),
			);
			return { containerId, content, tail: 200 };
		} catch (error) {
			if (error instanceof PaasUiError) throw error;
			throw new PaasUiError("unavailable", { cause: error });
		}
	}

	private assertService(serviceId: string): void {
		if (!Object.hasOwn(this.config.getServices(), serviceId)) throw new PaasUiError("not-found");
	}

	private ingressUrl(identity: string): string {
		const { baseDomain, httpPort, httpsPort } = this.config.getIngressConfig();
		const secure = httpsPort !== undefined;
		const port = httpsPort ?? httpPort;
		return `${secure ? "https" : "http"}://${identity}.${baseDomain}${port === (secure ? 443 : 80) ? "" : `:${port}`}`;
	}

	private descriptor(serviceId: string): Promise<{ revision: string; descriptor: ServiceDescriptor } | undefined> {
		const result = this.pending.then(async () => {
			try {
				const file = await this.git.fetchFile(serviceId, this.config.getServices()[serviceId]!);
				return { revision: file.revision, descriptor: this.decode(file.content, serviceId, file.revision) };
			} catch (err) {
				this.log.error({ err, serviceId }, "Cannot load management UI descriptor");
				return undefined;
			}
		});
		this.pending = result;
		return result;
	}

	private secrets(descriptor?: ServiceDescriptor): string[] {
		const secrets: string[] = [];
		for (const resource of Object.values(descriptor?.resources ?? {})) {
			if ("env" in resource)
				for (const entry of resource.env ?? []) if ("value" in entry) secrets.push(entry.value);
		}
		return secrets.filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length);
	}
}
