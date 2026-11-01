import type { IPaasConfig } from "../config/paas-config.ts";
import type { PeriodicTask } from "../task/periodic.ts";
import { createLogger, withLogContext } from "../util/logger.ts";
import type { ISleep } from "../util/sleep.ts";
import type { IDockerEventClient } from "./docker-event-client.ts";
import type { DockerContainerDetails, DockerEvent, DockerNetwork, Labels } from "./types.ts";

export interface IEventInventory {
	inspectContainer(id: string): Promise<DockerContainerDetails | null>;
	inspectNetwork(id: string): Promise<DockerNetwork | null>;
}

export interface IDockerEventWatcher {
	/** Resolves after response headers, before callers begin initial inventory. */
	start(): Promise<void>;
	/** Remember only independently verified owned network identities. */
	rememberNetwork(id: string, serviceId: string): void;
	/** Cancel subscription/backoff and settle mapping, probes and audits. */
	stop(): Promise<void>;
}

/** One stream; scans, probes and deployment never block consumption. */
export class DockerEventWatcher implements IDockerEventWatcher {
	private readonly log = createLogger(DockerEventWatcher.name);
	private readonly abort = new AbortController();
	private readonly networks = new Map<string, string>();
	private readonly hints = new Map<string, DockerEvent>();
	private readonly refreshes = new Set<string>();
	private mapping: Promise<void> | undefined;
	private observing: Promise<void> | undefined;
	private running: Promise<void> | undefined;
	private ready: Promise<void> | undefined;
	private auditWork: Promise<void> | undefined;
	private auditAgain = false;

	constructor(
		private readonly client: IDockerEventClient,
		private readonly inventory: IEventInventory,
		private readonly config: IPaasConfig,
		private readonly scheduler: { invalidate(serviceId: string): void },
		private readonly health: { invalidateService(serviceId: string): void },
		private readonly state: { refresh(serviceId: string): Promise<void> },
		private readonly audit: PeriodicTask,
		private readonly sleep: ISleep,
		private readonly generateTaskId: () => string,
	) {}

	start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((resolve, reject) => {
			this.running = this.consume(resolve).finally(() =>
				reject(new Error("Docker event watcher stopped before connection")),
			);
		});
		return this.ready;
	}

	rememberNetwork(id: string, serviceId: string): void {
		if (this.networks.size >= Math.max(64, Object.keys(this.config.getServices()).length * 4))
			this.networks.delete(this.networks.keys().next().value!);
		this.networks.set(id, serviceId);
	}

	async stop(): Promise<void> {
		this.abort.abort();
		this.hints.clear();
		this.refreshes.clear();
		await this.running;
		await this.mapping;
		await this.observing;
		await this.auditWork;
	}

	private async consume(ready: () => void): Promise<void> {
		let connected = false;
		let failures = 0;
		while (!this.abort.signal.aborted) {
			await withLogContext({ task: "docker-events", taskId: this.generateTaskId() }, async () => {
				try {
					const events = await this.client.subscribe(this.abort.signal);
					if (this.abort.signal.aborted) return;
					ready();
					if (connected) this.requestAudit();
					connected = true;
					for await (const event of events) {
						if (this.abort.signal.aborted) break;
						failures = 0;
						const cluster = event.attributes["homelab-paas.cluster"];
						if (cluster && cluster !== this.config.getClusterId()) continue;
						if (event.type === "container" && cluster) this.labels(event.attributes, event.action);
						else this.enqueue(event);
					}
					if (!this.abort.signal.aborted) throw new Error("Docker event stream ended");
				} catch (err) {
					if (!this.abort.signal.aborted)
						this.log.error({ err }, "Docker event subscription lost; reconnecting and auditing");
				}
			});
			if (this.abort.signal.aborted) break;
			try {
				await this.sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)), this.abort.signal);
			} catch (err) {
				if (!this.abort.signal.aborted) this.log.error({ err }, "Docker event reconnect delay failed");
			}
		}
	}

	private enqueue(event: DockerEvent): void {
		if (this.hints.size >= 1024) {
			this.requestAudit();
			return;
		}
		this.hints.set(`${event.type}/${event.id}`, event);
		this.dispatchMapping();
	}

	private dispatchMapping(): void {
		if (this.mapping || !this.hints.size || this.abort.signal.aborted) return;
		this.mapping = this.mapHints().finally(() => {
			this.mapping = undefined;
			this.dispatchMapping();
		});
	}

	private async mapHints(): Promise<void> {
		while (this.hints.size && !this.abort.signal.aborted) {
			const [key, event] = this.hints.entries().next().value!;
			this.hints.delete(key);
			try {
				if (event.type === "network") {
					const remembered = this.networks.get(event.id);
					if (remembered) {
						this.invalidate(remembered, event.action);
						continue;
					}
					const network = await this.inventory.inspectNetwork(event.id);
					if (!network) {
						this.requestAudit();
						continue;
					}
					if (network.labels["homelab-paas.cluster"] !== this.config.getClusterId()) continue;
					const id = network.labels["homelab-paas.service"];
					if (id && Object.hasOwn(this.config.getServices(), id)) this.rememberNetwork(network.id, id);
					this.labels(network.labels, event.action);
				} else {
					const container = await this.inventory.inspectContainer(event.id);
					if (!container) this.requestAudit();
					else this.labels(container.labels, event.action);
				}
			} catch (err) {
				this.log.error({ err }, "Cannot map Docker invalidation; requesting safety audit");
				this.requestAudit();
			}
		}
	}

	private labels(labels: Labels, action: string): void {
		if (labels["homelab-paas.cluster"] !== this.config.getClusterId()) return;
		const id = labels["homelab-paas.service"];
		if (id && Object.hasOwn(this.config.getServices(), id)) this.invalidate(id, action);
		else if (["control-plane", "envoy"].includes(labels["homelab-paas.role"] ?? ""))
			for (const serviceId of Object.keys(this.config.getServices())) this.invalidate(serviceId, action);
		else this.requestAudit();
	}

	private invalidate(serviceId: string, action: string): void {
		this.health.invalidateService(serviceId);
		if (!action.startsWith("health_status:")) this.scheduler.invalidate(serviceId);
		this.refreshes.add(serviceId);
		this.dispatchObservation();
	}

	private dispatchObservation(): void {
		if (this.observing || !this.refreshes.size || this.abort.signal.aborted) return;
		this.observing = this.observe().finally(() => {
			this.observing = undefined;
			this.dispatchObservation();
		});
	}

	private async observe(): Promise<void> {
		while (this.refreshes.size && !this.abort.signal.aborted) {
			const id = this.refreshes.values().next().value!;
			this.refreshes.delete(id);
			try {
				await this.state.refresh(id);
			} catch (err) {
				this.log.error({ err, serviceId: id }, "Cannot refresh lifecycle observation");
			}
		}
	}

	private requestAudit(): void {
		this.auditAgain = true;
		if (this.auditWork || this.abort.signal.aborted) return;
		this.auditWork = this.auditLoop().finally(() => {
			this.auditWork = undefined;
			if (this.auditAgain) this.requestAudit();
		});
	}

	private async auditLoop(): Promise<void> {
		while (this.auditAgain && !this.abort.signal.aborted) {
			this.auditAgain = false;
			try {
				await this.audit.run();
			} catch (err) {
				this.log.error({ err }, "Docker event safety audit failed");
			}
		}
	}
}
