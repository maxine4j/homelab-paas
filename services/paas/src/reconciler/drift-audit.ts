import type { IPaasConfig } from "../config/paas-config.ts";
import type { IDockerInfrastructure } from "../docker/docker-service.ts";
import type { DockerContainerDetails, DockerNetwork, ServiceContainer } from "../docker/types.ts";
import type { IStaticStore } from "../static/static-store.ts";
import { createLogger, withLogContext } from "../util/logger.ts";
import { DesiredInputError, type IDesiredInputs } from "./desired-inputs.ts";
import type { IRouteVerifier } from "./networking/networking-service.ts";
import type { Endpoint } from "./networking/types.ts";
import type { IOrphanCleanup } from "./orphan-cleanup.ts";
import type { IResourceSpecification } from "./resource-specification.ts";

export interface IAuditDocker {
	listServiceContainers(serviceId: string): Promise<ServiceContainer[]>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
	inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null>;
}

export interface IDriftAudit {
	/** Serialized bounded inventory. Requests during a scan retain another pass for affected services.
	 * Errors discard healthy observations, enqueue recovery and reject after other services are scanned.
	 * Routing verification never treats this partial inventory as an authoritative route snapshot.
	 */
	run(serviceId?: string): Promise<void>;
	stop(): Promise<void>;
}

export class DriftAudit implements IDriftAudit {
	private readonly log = createLogger(DriftAudit.name);
	private readonly pending = new Set<string>();
	private running: Promise<void> | undefined;
	private stopped = false;

	constructor(
		private readonly config: IPaasConfig,
		private readonly inputs: { read: IDesiredInputs["read"] },
		private readonly docker: IAuditDocker,
		private readonly infrastructure: IDockerInfrastructure,
		private readonly specification: IResourceSpecification,
		private readonly scheduler: {
			refreshInputs(serviceId: string): Promise<void>;
			invalidate(serviceId: string): void;
		},
		private readonly endpoints: { getAll(): Promise<Record<string, Endpoint>> },
		private readonly networking: IRouteVerifier,
		private readonly health: { invalidateService(serviceId: string): void },
		private readonly state: { refresh(serviceId: string): Promise<void> },
		private readonly rememberNetwork: (networkId: string, serviceId: string) => void,
		private readonly generateTaskId: () => string,
		private readonly staticStore?: { inspect: IStaticStore["inspect"] },
		private readonly orphanCleanup?: { run: IOrphanCleanup["run"] },
	) {}

	run(serviceId?: string): Promise<void> {
		if (this.stopped) return Promise.resolve();
		for (const id of serviceId === undefined ? Object.keys(this.config.getServices()) : [serviceId]) {
			if (Object.hasOwn(this.config.getServices(), id)) this.pending.add(id);
		}
		if (!this.running) this.running = Promise.resolve().then(() => this.drain());
		return this.running;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.pending.clear();
		await this.running?.catch(() => {});
	}

	private async drain(): Promise<void> {
		const failures: unknown[] = [];
		try {
			do {
				await withLogContext({ task: "drift-audit", taskId: this.generateTaskId() }, async () => {
					while (this.pending.size && !this.stopped) {
						const id = this.pending.values().next().value!;
						this.pending.delete(id);
						if (!Object.hasOwn(this.config.getServices(), id)) continue;
						try {
							await this.scheduler.refreshInputs(id);
							await this.inspect(id);
							await this.state.refresh(id);
						} catch (err) {
							this.health.invalidateService(id);
							this.scheduler.invalidate(id);
							this.log.error(
								{ err, serviceId: id },
								"Safety inventory failed; retaining routes and scheduling recovery",
							);
							if (!(err instanceof DesiredInputError)) failures.push(err);
							// Replace management snapshots from fresh observations even when the audit failed.
							try {
								await this.state.refresh(id);
							} catch (error) {
								failures.push(error);
							}
						}
					}
					if (!this.stopped) {
						try {
							await this.orphanCleanup?.run();
						} catch (err) {
							failures.push(err);
						}
						try {
							await this.networking.verifyRoutes();
						} catch (err) {
							for (const id of Object.keys(this.config.getServices())) {
								this.health.invalidateService(id);
								this.scheduler.invalidate(id);
							}
							failures.push(err);
						}
					}
				});
			} while (this.pending.size && !this.stopped);
			if (failures.length) throw new AggregateError(failures, "Safety audit failed");
		} finally {
			this.running = undefined;
		}
	}

	private async inspect(serviceId: string): Promise<void> {
		const desired = await this.inputs.read(serviceId);
		const workloads = desired.resources.some(([, resource]) => resource.type !== "static");
		const containers = workloads ? await this.docker.listServiceContainers(serviceId) : [];
		const network = workloads ? await this.docker.inspectServiceNetwork(serviceId) : null;
		if (network) this.rememberNetwork(network.id, serviceId);
		let drift = workloads && !(await this.infrastructure.inspectServiceInfrastructure(serviceId));
		const routes = await this.endpoints.getAll();
		for (const [resourceId, resource] of desired.resources) {
			if (resource.type === "static") {
				const actual = routes[`${resourceId}.${serviceId}`];
				if (
					(await this.staticStore?.inspect({
						serviceId,
						resourceId,
						revision: desired.revision,
						path: resource.path,
					})) !== "current"
					|| !actual?.static
					|| actual.port !== 8081
					|| actual.public !== (resource.ingress?.public ?? false)
					|| actual.primary !== (resource.primary ?? false)
				)
					drift = true;
				continue;
			}
			const current = containers.filter((entry) => entry.resourceId === resourceId);
			if (current.length !== (resource.replicas ?? 1)) drift = true;
			for (const container of current) {
				const details = await this.docker.inspectServiceContainer(serviceId, container.id);
				const matches =
					container.spec === this.specification.get(resourceId, resource)
					&& container.state === "running"
					&& this.specification.matchesRuntime(resourceId, resource, details, network);
				if (!matches) {
					drift = true;
					continue;
				}
				if (resource.type === "web" && network && details) {
					const expected = {
						address: details.networks[network.name]!.address,
						port: resource.ingress.port,
						public: resource.ingress.public ?? false,
						primary: resource.primary ?? true,
						healthcheckPath: resource.healthcheckUrl ?? undefined,
					};
					const actual = routes[`${resourceId}.${serviceId}`];
					if (
						!actual
						|| expected.address !== actual.address
						|| expected.port !== actual.port
						|| expected.public !== actual.public
						|| expected.primary !== (actual.primary ?? true)
						|| expected.healthcheckPath !== (actual.healthcheckPath ?? undefined)
					)
						drift = true;
				}
			}
		}
		if (drift) {
			this.log.info(
				{ event: "audit.drift", serviceId },
				"Safety audit detected drift; scheduling fresh reconciliation",
			);
			this.scheduler.invalidate(serviceId);
		}
	}
}
