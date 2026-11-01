import type { IPaasConfig } from "../config/paas-config.ts";
import type { IClusterWorkloads, IDockerService } from "../docker/docker-service.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger, withLogContext } from "../util/logger.ts";

export interface IOrphanCleanup {
	/** Observe accepted config removals; observational and service-scoped changes do not trigger scans. */
	initialize(): void;
	/** Serialized fresh cluster inventory after deployment work settles. Gracefully stops before removal.
	 * Attempts other containers after failures, then rejects with AggregateError. Later scans retry.
	 */
	run(): Promise<void>;
	/** Unsubscribe, discard pending work and settle the active retirement. */
	stop(): Promise<void>;
}

export class OrphanCleanup implements IOrphanCleanup {
	private readonly log = createLogger(OrphanCleanup.name);
	private running: Promise<void> | undefined;
	private pending = false;
	private stopped = false;
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly config: IPaasConfig,
		private readonly docker: IClusterWorkloads & {
			stopServiceContainer: IDockerService["stopServiceContainer"];
			removeServiceContainer: IDockerService["removeServiceContainer"];
		},
		private readonly scheduler: { settle(): Promise<void> },
		private readonly changes: IChangeBus,
		private readonly generateTaskId: () => string,
	) {}

	initialize(): void {
		if (this.unsubscribe || this.stopped) return;
		let previous = new Set(Object.keys(this.config.getServices()));
		this.unsubscribe = this.changes.subscribe((change) => {
			if (!change.desiredInputs || change.serviceId !== undefined) return;
			const current = new Set(Object.keys(this.config.getServices()));
			const removed = [...previous].some((id) => !current.has(id));
			previous = current;
			// run reports failures inside its task context; accepted config writes remain successful.
			if (removed) void this.run().catch(() => {});
		});
	}

	run(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		this.pending = true;
		this.running ??= Promise.resolve().then(() =>
			withLogContext({ task: "orphan-cleanup", taskId: this.generateTaskId() }, () => this.drain()),
		);
		return this.running;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.pending = false;
		this.unsubscribe?.();
		await this.running?.catch(() => {});
	}

	private async drain(): Promise<void> {
		const failures: unknown[] = [];
		try {
			while (this.pending && !this.stopped) {
				this.pending = false;
				try {
					await this.scheduler.settle();
					if (this.stopped) break;
					const containers = await this.docker.listClusterWorkloads();
					for (const { id, serviceId } of containers) {
						if (this.stopped) break;
						if (Object.hasOwn(this.config.getServices(), serviceId)) continue;
						try {
							await this.docker.stopServiceContainer(serviceId, id, 30);
							if (Object.hasOwn(this.config.getServices(), serviceId)) continue;
							await this.docker.removeServiceContainer(serviceId, id);
							this.log.info({ serviceId, containerId: id }, "Removed orphaned service container");
						} catch (err) {
							this.log.error(
								{ err, serviceId, containerId: id },
								"Cannot retire orphaned service container",
							);
							failures.push(err);
						}
					}
				} catch (err) {
					failures.push(err);
				}
			}
			if (failures.length) throw new AggregateError(failures, "Orphan cleanup failed");
		} catch (err) {
			this.log.error({ err }, "Orphan cleanup failed; next safety audit will retry");
			throw err;
		} finally {
			this.running = undefined;
		}
	}
}
