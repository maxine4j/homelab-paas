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
	refresh(): Promise<void>;
}

interface SnapshotEntry<T> {
	load: () => Promise<T>;
	result?: { data: T } | { error: unknown };
	pending?: Promise<T>;
}

/** Shared read-through state cache. Only explicit refreshes replace warm snapshots. */
export class CachedPaasUiService implements IPaasUiService, IUiStateCache {
	private readonly log = createLogger(CachedPaasUiService.name);
	private readonly lists = new Map<string, SnapshotEntry<UiServiceSummary[]>>();
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

	listServices(): Promise<UiServiceSummary[]> {
		return this.read(this.lists, "services", () => this.ui.listServices());
	}

	async getService(serviceId: string): Promise<UiService> {
		this.assertService(serviceId);
		return this.read(this.services, serviceId, () => this.ui.getService(serviceId));
	}

	async getResource(serviceId: string, resourceId: string): Promise<UiResource> {
		this.assertService(serviceId);
		return this.read(this.resources, JSON.stringify([serviceId, resourceId]), () =>
			this.ui.getResource(serviceId, resourceId),
		);
	}

	getEvents(serviceId: string): Promise<UiServiceEvent[]> {
		return this.ui.getEvents(serviceId);
	}

	getLogs(serviceId: string, resourceId: string, containerId: string): Promise<UiLogs> {
		return this.ui.getLogs(serviceId, resourceId, containerId);
	}

	refresh(): Promise<void> {
		const pending = this.refreshing.then(() => this.refreshSnapshots());
		this.refreshing = pending.catch(() => {});
		return pending;
	}

	private async refreshSnapshots(): Promise<void> {
		this.synchronize();
		this.entry(this.lists, "services", () => this.ui.listServices());
		for (const serviceId of Object.keys(this.config.getServices()))
			this.entry(this.services, serviceId, () => this.ui.getService(serviceId));
		await Promise.all([
			this.refreshEntries(this.lists),
			this.refreshEntries(this.services),
			this.refreshEntries(this.resources),
		]);
		for (const serviceId of Object.keys(this.config.getServices())) this.changes.publish({ serviceId });
	}

	private async refreshEntries<T>(entries: Map<string, SnapshotEntry<T>>): Promise<void> {
		await Promise.all(
			[...entries].map(async ([key, entry]) => {
				try {
					// A miss may have started before the new health/Git observation; replace its result too.
					await entry.pending?.catch(() => {});
					await this.load(entry);
				} catch (err) {
					this.log.error(
						{ err, key },
						"Cannot refresh management state snapshot; cached reads will report unavailable",
					);
				}
			}),
		);
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
		this.lists.clear();
		this.services.clear();
		this.resources.clear();
	}

	private assertService(serviceId: string): void {
		if (!Object.hasOwn(this.config.getServices(), serviceId)) throw new PaasUiError("not-found");
	}
}
