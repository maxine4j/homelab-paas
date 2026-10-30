import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import type { ISleep } from "../../../util/sleep.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { Endpoint } from "../../networking/types.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./types.ts";

/** Keeps the old revision until the replacement is ready and its route accepted.
 * Callers serialize deployments and schedule retries. Retirement failures retain
 * the routed replacement; old containers receive their full graceful-stop timeout.
 */
export class SurgeDeploymentStrategy implements DeploymentStrategy {
	readonly name = "surge";

	constructor(
		private readonly docker: IDockerService,
		private readonly networking: INetworkingService,
		private readonly probe: HttpProbe,
		private readonly sleep: ISleep,
		/** Must return a fresh Docker-name-safe identity for every attempt. */
		private readonly generateInstanceId: () => string,
	) {}

	async deploy(request: DeploymentRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const current = await this.docker.listServiceContainers(serviceId, resourceId);
		const imageId = await this.docker.resolveImage(resource.image);
		await this.docker.prepareServiceNetwork(serviceId);
		const network = await this.docker.inspectServiceNetwork(serviceId);
		if (!network) throw new Error("Service network is unavailable");
		const containerId = await this.docker.createResourceContainer({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
			instanceId: this.generateInstanceId(),
			imageId,
			command: resource.command,
			env: Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
			volumes: resource.volumes,
			devices: resource.devices,
			supplementaryGroups: resource.supplementaryGroups,
			hostPorts: resource.hostPorts,
			limits: resource.limits,
		});
		let endpoint: Endpoint;
		try {
			await this.docker.startServiceContainer(serviceId, containerId);
			endpoint = await this.waitReady(request, containerId, network.name);
		} catch (failure) {
			try {
				await this.docker.stopServiceContainer(
					serviceId,
					containerId,
					resource.termination?.timeoutSeconds ?? 30,
				);
				await this.docker.removeServiceContainer(serviceId, containerId);
			} catch (cleanupFailure) {
				throw new AggregateError([failure, cleanupFailure], "Replacement startup and cleanup failed");
			}
			throw failure;
		}
		// A rejected publication can have an uncertain outcome. Keep both revisions
		// alive rather than deleting a replacement that may already receive traffic.
		await this.networking.routeTo(`${resourceId}.${serviceId}`, endpoint);
		if (current.length === 0) return;
		const timeoutSeconds = resource.termination?.timeoutSeconds ?? 30;
		const results = await Promise.allSettled(
			current.map(async (container) => {
				await this.docker.stopServiceContainer(serviceId, container.id, timeoutSeconds);
				await this.docker.removeServiceContainer(serviceId, container.id);
			}),
		);
		const failures: unknown[] = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length > 0) throw new AggregateError(failures, "Failed to retire previous containers");
	}

	private async waitReady(request: DeploymentRequest, containerId: string, networkName: string): Promise<Endpoint> {
		const { serviceId, resource } = request;
		for (let attempt = 0; attempt < 30; attempt++) {
			const container = await this.docker.inspectServiceContainer(serviceId, containerId);
			const address = container?.networks[networkName]?.address;
			if (container?.running && address) {
				const endpoint: Endpoint = {
					address,
					port: resource.ingress.port,
					healthcheckPath: resource.healthcheckUrl ?? undefined,
					public: resource.ingress.public ?? false,
					primary: resource.primary ?? true,
				};
				if (!endpoint.healthcheckPath || (await this.probe(address, endpoint.port, endpoint.healthcheckPath)))
					return endpoint;
			}
			if (attempt < 29) await this.sleep(1000);
		}
		throw new Error("Container readiness failed; check container startup and healthcheckUrl");
	}
}
