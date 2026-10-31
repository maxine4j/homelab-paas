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
	UiRevisionMetadata,
} from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IDockerLogService } from "../docker/docker-log-service.ts";
import type { IGitRevisionService } from "../git/git-service.ts";
import type { IResourceHealthReader } from "../health/resource-health-service.ts";
import type { IServiceEventStore } from "../reconciler/service-event-store.ts";
import type { DescriptorDecoder, IReconciliationStateStore } from "../reconciler/types.ts";
import type { IResourceStatusService } from "../status/resource-status-service.ts";
import { createLogger } from "../util/logger.ts";
import { stringifyYaml } from "../util/yaml.ts";
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

export interface IPaasUiLogService {
	followLogs(
		serviceId: string,
		resourceId: string,
		containerId: string,
		receive: (logs: UiLogs) => void,
		signal: AbortSignal,
	): Promise<void>;
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

export class PaasUiService implements IPaasUiService, IPaasUiLogService {
	private readonly log = createLogger(PaasUiService.name);
	constructor(
		private readonly status: IResourceStatusService,
		private readonly config: IPaasConfig,
		private readonly git: IGitRevisionService,
		private readonly decode: DescriptorDecoder,
		private readonly docker: UiDocker,
		private readonly state: IReconciliationStateStore,
		private readonly events: IServiceEventStore,
		private readonly health: IResourceHealthReader,
		private readonly logs?: IDockerLogService,
	) {}

	async followLogs(
		serviceId: string,
		resourceId: string,
		containerId: string,
		receive: (logs: UiLogs) => void,
		signal: AbortSignal,
	): Promise<void> {
		this.assertService(serviceId);
		try {
			const containers = await this.docker.listServiceContainers(serviceId, resourceId);
			if (!containers.some((container) => container.id === containerId && container.resourceId === resourceId))
				throw new PaasUiError("not-found");
			const file = await this.descriptor(serviceId);
			if (!file || !this.logs) throw new PaasUiError("unavailable");
			await this.logs.follow(
				serviceId,
				containerId,
				this.secrets(file.descriptor),
				(content) => receive({ containerId, content, tail: 200 }),
				signal,
			);
		} catch (cause) {
			if (signal.aborted) return;
			if (cause instanceof PaasUiError) throw cause;
			throw new PaasUiError("unavailable", { cause });
		}
	}

	async getCluster(): Promise<UiCluster> {
		return {
			clusterId: this.config.getClusterId(),
			...this.config.getEditableConfig(),
		};
	}

	async getEvents(serviceId: string): Promise<UiServiceEvent[]> {
		this.assertService(serviceId);
		try {
			return (await this.events.list(serviceId)).map((event) => this.presentEvent(event));
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
						const snapshot = await this.serviceSnapshot(serviceId, true, true);
						return {
							serviceId,
							sync: snapshot.sync,
							health: snapshot.health,
							description: snapshot.description,
							primaryUrl: snapshot.primaryUrl,
							desiredRevision: snapshot.desiredRevision,
							activeRevision: snapshot.activeRevision,
							activeRevisionMetadata: snapshot.activeRevisionMetadata,
							desiredRevisionMetadata: snapshot.desiredRevisionMetadata,
							failures: snapshot.failures,
							retryAt: snapshot.retryAt,
						};
					}),
			);
		} catch (cause) {
			throw new PaasUiError("unavailable", { cause });
		}
	}

	getService(serviceId: string): Promise<UiService> {
		return this.serviceSnapshot(serviceId, true);
	}

	async getResource(serviceId: string, resourceId: string): Promise<UiResource> {
		const resource = (await this.serviceSnapshot(serviceId, false)).resources.find(
			(resource) => resource.resourceId === resourceId,
		);
		if (!resource) throw new PaasUiError("not-found");
		try {
			const containers = await Promise.all(
				resource.containers.map(async (container) => {
					const details = await this.docker.inspectServiceContainer(serviceId, container.id);
					return {
						...container,
						state: details ? container.state : "missing",
						running: details?.running,
						networks: details?.networks,
					};
				}),
			);
			const health =
				resource.health === "Progressing"
					? "Progressing"
					: !containers.length || containers.every(({ state }) => state === "missing")
						? "Missing"
						: containers.some(({ running }) => !running)
							? "Degraded"
							: resource.health;
			const sync =
				resource.sync !== "Unknown"
				&& (health === "Missing" || containers.some(({ state }) => state === "missing"))
					? "OutOfSync"
					: resource.sync;
			return { ...resource, sync, health, containers };
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

	private async serviceSnapshot(
		serviceId: string,
		includeRevisionMetadata: boolean,
		tolerateDockerFailure = false,
	): Promise<UiService> {
		this.assertService(serviceId);
		try {
			let dockerAvailable = true;
			const [state, containers, file] = await Promise.all([
				this.state.read(serviceId),
				this.docker.listServiceContainers(serviceId).catch((err: unknown) => {
					if (!tolerateDockerFailure) throw err;
					this.log.error({ err, serviceId }, "Cannot observe management service containers");
					dockerAvailable = false;
					return [];
				}),
				this.descriptor(serviceId),
			]);
			const resources = file?.descriptor.resources ?? {};
			const webCount = Object.values(resources).filter((resource) => resource.type === "web").length;
			const secrets = this.secrets(file?.descriptor);
			const metadata = includeRevisionMetadata
				? await this.revisionMetadata(
						serviceId,
						[
							state?.activeRevision,
							file?.revision ?? (tolerateDockerFailure ? state?.desiredRevision : undefined),
						],
						secrets,
					)
				: new Map<string, UiRevisionMetadata>();
			const ids = [
				...new Set([...Object.keys(resources), ...containers.map((container) => container.resourceId)]),
			].sort();
			const observedResources = await Promise.all(
				ids.map(async (resourceId): Promise<UiResource> => ({
					resourceId,
					sync: dockerAvailable
						? await this.status.getSync({
								serviceId,
								resourceId,
								descriptorAvailable: Boolean(file),
								resource:
									resources[resourceId]?.type === "web"
										? {
												...resources[resourceId],
												primary: webCount === 1 || resources[resourceId].primary === true,
											}
										: resources[resourceId],
								containers: containers.filter((container) => container.resourceId === resourceId),
							})
						: "Unknown",
					health: dockerAvailable
						? this.health.getStatus(
								serviceId,
								resourceId,
								containers.filter((container) => container.resourceId === resourceId),
							)
						: "Unknown",
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
					config: resources[resourceId] ? this.config.sanitize(resources[resourceId]) : undefined,
					configYaml: resources[resourceId]
						? stringifyYaml(this.config.sanitize(resources[resourceId]))
						: undefined,
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
			);

			return {
				serviceId,
				...this.status.aggregate(observedResources),
				description:
					file?.descriptor.metadata.description === undefined
						? undefined
						: this.config.redact(file.descriptor.metadata.description, secrets),
				primaryUrl: Object.values(resources).some(
					(resource) => resource.type === "web" && (webCount === 1 || resource.primary),
				)
					? this.ingressUrl(serviceId)
					: undefined,
				desiredRevision: file?.revision ?? state?.desiredRevision,
				activeRevision: state?.activeRevision,
				failures: state?.failures,
				retryAt: state?.retryAt,
				source: this.config.sanitize(this.config.getServices()[serviceId], secrets),
				descriptorRevision: file?.revision,
				activeRevisionMetadata: state?.activeRevision ? metadata.get(state.activeRevision) : undefined,
				descriptorRevisionMetadata: file ? metadata.get(file.revision) : undefined,
				desiredRevisionMetadata: metadata.get(file?.revision ?? state?.desiredRevision ?? ""),
				descriptorStatus: file ? "available" : "unavailable",
				descriptor: file ? this.config.sanitize(file.descriptor) : undefined,
				descriptorYaml: file ? stringifyYaml(this.config.sanitize(file.descriptor)) : undefined,
				resources: observedResources,
			};
		} catch (error) {
			if (error instanceof PaasUiError) throw error;
			throw new PaasUiError("unavailable", { cause: error });
		}
	}

	private presentEvent(event: UiServiceEvent): UiServiceEvent {
		if (!event.diagnostics) return event;
		try {
			const diagnostic: unknown = JSON.parse(event.diagnostics);
			if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return event;
			if (!("context" in diagnostic) || "contextYaml" in diagnostic) return event;
			const { context, ...details } = diagnostic;
			const yaml = stringifyYaml(context);
			const serialize = (length: number): string =>
				JSON.stringify({
					...details,
					contextYaml: length === yaml.length ? yaml : `${yaml.slice(0, length)}\n[truncated]`,
				});
			if (Buffer.byteLength(JSON.stringify(serialize(0))) > 32768) return event;
			let start = 0;
			let end = yaml.length;
			while (start < end) {
				const middle = Math.ceil((start + end) / 2);
				if (Buffer.byteLength(JSON.stringify(serialize(middle))) <= 32768) start = middle;
				else end = middle - 1;
			}
			return { ...event, diagnostics: serialize(start) };
		} catch {
			return event;
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

	private async descriptor(
		serviceId: string,
	): Promise<{ revision: string; descriptor: ServiceDescriptor } | undefined> {
		try {
			const file = await this.git.fetchFile(serviceId, this.config.getServices()[serviceId]!);
			return { revision: file.revision, descriptor: this.decode(file.content, serviceId, file.revision) };
		} catch (err) {
			this.log.error({ err, serviceId }, "Cannot load management UI descriptor");
			return undefined;
		}
	}

	private async revisionMetadata(
		serviceId: string,
		revisions: (string | undefined)[],
		secrets: string[],
	): Promise<Map<string, UiRevisionMetadata>> {
		const metadata = new Map<string, UiRevisionMetadata>();
		for (const revision of new Set(revisions)) {
			if (!revision) continue;
			try {
				const commit = await this.git.readCommit(serviceId, this.config.getServices()[serviceId]!, revision);
				metadata.set(revision, {
					authorName: this.config.redact(commit.authorName, secrets),
					authoredAt: commit.authoredAt,
					message: this.config.redact(commit.message, secrets),
				});
			} catch (err) {
				this.log.error({ err, serviceId, revision }, "Cannot load management UI revision metadata");
			}
		}
		return metadata;
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
