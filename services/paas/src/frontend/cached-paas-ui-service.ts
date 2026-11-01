import type {
	UiCluster,
	UiConfigUpdate,
	UiEditableConfig,
	UiLogs,
	UiResource,
	UiService,
	UiServiceEvent,
	UiServiceSummary,
} from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger } from "../util/logger.ts";
import { PaasUiError, type IPaasUiService } from "./paas-ui-service.ts";

export interface IUiStateCache {
	/** Warms configured services and replaces previously requested resource snapshots. Failures are cached per entry. */
	refresh(serviceId?: string): Promise<void>;
}

interface SnapshotEntry<T> {
	load: () => Promise<T>;
	result?: { data: T } | { error: unknown };
	pending?: Promise<T>;
}

/** Shared read-through state cache. Only explicit refreshes replace warm snapshots. */
export class CachedPaasUiService implements IPaasUiService, IUiStateCache {
	private readonly log = createLogger(CachedPaasUiService.name);
	private readonly services = new Map<string, SnapshotEntry<UiService>>();
	private readonly resources = new Map<string, SnapshotEntry<UiResource>>();
	private configuration: string | undefined;
	private refreshing: Promise<void> = Promise.resolve();

	constructor(
		private readonly ui: IPaasUiService,
		private readonly config: IPaasConfig,
		private readonly changes: IChangeBus,
	) {}

	getCluster(): Promise<UiCluster> {
		return this.ui.getCluster();
	}

	updateConfig(update: UiConfigUpdate): Promise<UiEditableConfig> {
		return this.ui.updateConfig(update);
	}

	async listServices(): Promise<UiServiceSummary[]> {
		return Promise.all(
			Object.keys(this.config.getServices())
				.sort()
				.map(async (serviceId) => {
					try {
						const snapshot = await this.getService(serviceId);
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
					} catch {
						return { serviceId, sync: "Unknown" as const, health: "Unknown" as const };
					}
				}),
		);
	}

	async getService(serviceId: string): Promise<UiService> {
		this.assertService(serviceId);
		return this.read(this.services, serviceId, () => this.ui.getService(serviceId, true));
	}

	async getResource(serviceId: string, resourceId: string): Promise<UiResource> {
		this.assertService(serviceId);
		return this.read(this.resources, JSON.stringify([serviceId, resourceId]), async () =>
			this.ui.getResource(serviceId, resourceId, await this.getService(serviceId)),
		);
	}

	getEvents(serviceId: string): Promise<UiServiceEvent[]> {
		return this.ui.getEvents(serviceId);
	}

	getLogs(serviceId: string, resourceId: string, containerId: string): Promise<UiLogs> {
		return this.ui.getLogs(serviceId, resourceId, containerId);
	}

	refresh(serviceId?: string): Promise<void> {
		const pending = this.refreshing.then(() => this.refreshSnapshots(serviceId));
		this.refreshing = pending.catch(() => {});
		return pending;
	}

	private async refreshSnapshots(onlyServiceId?: string): Promise<void> {
		this.synchronize();
		const serviceIds = Object.keys(this.config.getServices()).filter(
			(id) => onlyServiceId === undefined || id === onlyServiceId,
		);
		await Promise.all(
			serviceIds.map(async (serviceId) => {
				const service = this.entry(this.services, serviceId, () => this.ui.getService(serviceId, true));
				const changed = await this.refreshEntry(serviceId, service);
				const resourcesChanged = await Promise.all(
					[...this.resources]
						.filter(([key]) => JSON.parse(key)[0] === serviceId)
						.map(([key, entry]) => this.refreshEntry(key, entry)),
				);
				if (changed || resourcesChanged.some(Boolean)) this.changes.publish({ serviceId });
			}),
		);
	}

	private async refreshEntry<T>(key: string, entry: SnapshotEntry<T>): Promise<boolean> {
		await entry.pending?.catch(() => {});
		const before = this.identity(entry.result);
		try {
			await this.load(entry);
		} catch (err) {
			this.log.error(
				{ err, key },
				"Cannot refresh management state snapshot; cached reads will report unavailable",
			);
		}
		return this.identity(entry.result) !== before;
	}

	private identity<T>(result: SnapshotEntry<T>["result"]): string | undefined {
		if (!result) return undefined;
		return "error" in result ? `error:${String(result.error)}` : JSON.stringify(result.data);
	}

	private async read<T>(cache: Map<string, SnapshotEntry<T>>, key: string, load: () => Promise<T>): Promise<T> {
		this.synchronize();
		const entry = this.entry(cache, key, load);
		if (!entry.result) await this.load(entry).catch(() => {});
		this.synchronize();
		if (cache.get(key) !== entry) return this.read(cache, key, load);
		if (!entry.result) throw new PaasUiError("unavailable");
		if ("error" in entry.result) throw entry.result.error;
		return structuredClone(entry.result.data);
	}

	private entry<T>(cache: Map<string, SnapshotEntry<T>>, key: string, load: () => Promise<T>): SnapshotEntry<T> {
		let entry = cache.get(key);
		if (!entry) {
			entry = { load };
			cache.set(key, entry);
		}
		return entry;
	}

	private load<T>(entry: SnapshotEntry<T>): Promise<T> {
		if (entry.pending) return entry.pending;
		const pending = entry.load().then(
			(data) => {
				entry.result = { data: structuredClone(data) };
				return data;
			},
			(error: unknown) => {
				entry.result = { error };
				throw error;
			},
		);
		entry.pending = pending;
		void pending
			.finally(() => {
				entry.pending = undefined;
			})
			.catch(() => {});
		return pending;
	}

	private synchronize(): void {
		const configuration = JSON.stringify([
			this.config.getServices(),
			this.config.getIngressConfig(),
			this.config.getAuthConfig(),
			this.config.getTlsConfig(),
		]);
		if (this.configuration === configuration) return;
		this.configuration = configuration;
		this.services.clear();
		this.resources.clear();
	}

	private assertService(serviceId: string): void {
		if (!Object.hasOwn(this.config.getServices(), serviceId)) throw new PaasUiError("not-found");
	}
}
