import type { IDockerService } from "../../../docker/docker-service.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { Endpoint } from "../../networking/types.ts";
import type { IDeploymentContainers } from "../deployment-containers.ts";
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
		private readonly containers: IDeploymentContainers,
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
			selinuxLabeling: resource.selinuxLabeling,
			hostPorts: resource.hostPorts,
			limits: resource.limits,
		});
		let endpoint: Endpoint;
		try {
			await this.docker.startServiceContainer(serviceId, containerId);
			endpoint = await this.waitReady(request, containerId, network.name);
		} catch (failure) {
			return this.containers.cleanupFailed(
				serviceId,
				[containerId],
				resource.termination?.timeoutSeconds ?? 30,
				failure,
				"Replacement startup and cleanup failed",
			);
		}
		// A rejected publication can have an uncertain outcome. Keep both revisions
		// alive rather than deleting a replacement that may already receive traffic.
		await this.networking.routeTo(`${resourceId}.${serviceId}`, endpoint);
		if (current.length === 0) return;
		const timeoutSeconds = resource.termination?.timeoutSeconds ?? 30;
		await this.containers.retire(
			serviceId,
			current.map(({ id }) => id),
			timeoutSeconds,
			"Failed to retire previous containers",
		);
	}

	private async waitReady(request: DeploymentRequest, containerId: string, networkName: string): Promise<Endpoint> {
		const { serviceId, resource } = request;
		const address = await this.containers.waitReady({
			serviceId,
			containerId,
			networkName,
			failureMessage: "Container readiness failed",
			healthcheck: resource.healthcheckUrl
				? {
						port: resource.ingress.port,
						path: resource.healthcheckUrl,
						failureMessage: `HTTP health check on port ${resource.ingress.port} at ${resource.healthcheckUrl} did not pass`,
					}
				: undefined,
		});
		return {
			address,
			port: resource.ingress.port,
			healthcheckPath: resource.healthcheckUrl ?? undefined,
			public: resource.ingress.public ?? false,
			primary: resource.primary ?? true,
		};
	}
}
