import { createHash } from "node:crypto";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import { createLogger } from "../../../util/logger.ts";
import type { DeploymentWorkerResource } from "../../deployment/types.ts";
import type { IWorkerDeploymentService } from "../../deployment/worker-deployment-service.ts";
import type { WorkerReconciliationRequest } from "./types.ts";

export interface IWorkerResourceReconciler {
	readonly type: "worker";
	readonly lifecycle: "deployment";
	/** Checks each replica's private HTTP readiness; delegates drift repair. Failures propagate. */
	reconcile(request: WorkerReconciliationRequest): Promise<void>;
}

export class WorkerResourceReconciler implements IWorkerResourceReconciler {
	private readonly log = createLogger(WorkerResourceReconciler.name);
	readonly type = "worker";
	readonly lifecycle = "deployment";

	constructor(
		private readonly docker: IDockerService,
		private readonly deployment: IWorkerDeploymentService,
		private readonly probe: HttpProbe,
	) {}

	async reconcile(request: WorkerReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const spec = this.fingerprint(resourceId, resource);
		const containers = await this.docker.listServiceContainers(serviceId, resourceId);
		if (
			containers.length === (resource.replicas ?? 1)
			&& containers.every((container) => container.spec === spec && container.state === "running")
		) {
			await this.docker.prepareServiceNetwork(serviceId);
			const network = await this.docker.inspectServiceNetwork(serviceId);
			let connected = Boolean(network);
			for (const current of containers) {
				const container = await this.docker.inspectServiceContainer(serviceId, current.id);
				const address = network && container?.networks[network.name]?.address;
				if (!network || !container?.running || !network.containerIds.includes(current.id) || !address) {
					connected = false;
					break;
				}
				if (!(await this.probe(address, resource.healthcheckPort, resource.healthcheckUrl ?? "/healthcheck")))
					throw new Error("Worker readiness failed; check private health check");
			}
			if (connected) return;
		}
		this.log.info(
			{
				event: "resource.drift",
				serviceId,
				resourceId,
				revision: request.revision,
				strategy: resource.rolloutStrategy ?? "recreate",
			},
			"Detected worker resource drift; reconciling replicas",
		);
		await this.deployment.deploy({ ...request, spec });
	}

	private fingerprint(resourceId: string, resource: DeploymentWorkerResource): string {
		const env = Object.entries(
			Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return createHash("sha256")
			.update(
				JSON.stringify([
					resourceId,
					{
						type: "worker",
						image: resource.image,
						...(resource.devices?.length
							? {
									devices: resource.devices.map(({ hostPath, mountPath, permissions }) => ({
										hostPath,
										mountPath,
										permissions: permissions ?? "rwm",
									})),
								}
							: {}),
						...(resource.supplementaryGroups?.length
							? { supplementaryGroups: [...resource.supplementaryGroups].sort((a, b) => a - b) }
							: {}),
						...(resource.hostPorts?.length ? { hostPorts: resource.hostPorts } : {}),
						command: resource.command ?? null,
						env,
						volumes:
							resource.volumes?.map(({ hostPath, mountPath, readOnly }) => ({
								hostPath,
								mountPath,
								readOnly: readOnly ?? false,
								selinux: "z",
							})) ?? [],
						limits: { cpus: resource.limits?.cpus, memoryMiB: resource.limits?.memoryMiB },
						replicas: resource.replicas ?? 1,
						rolloutStrategy: resource.rolloutStrategy ?? "recreate",
						healthcheckPort: resource.healthcheckPort,
						healthcheckUrl: resource.healthcheckUrl ?? "/healthcheck",
						terminationTimeoutSeconds: resource.termination?.timeoutSeconds ?? 30,
					},
				]),
			)
			.digest("hex");
	}
}
