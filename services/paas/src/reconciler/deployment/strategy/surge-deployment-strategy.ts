import type { IDockerService } from "../../../docker/docker-service.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { IResourceRoutingPolicy } from "../../networking/resource-routing-policy.ts";
import type { IDeploymentContainers } from "../deployment-containers.ts";
import type { DeploymentRequest } from "../types.ts";
import type { DeploymentStrategy } from "./types.ts";

/** Keeps the old revision until the replacement is ready and its route accepted.
 * Callers serialize deployments and schedule retries. Retirement failures retain
 * the routed replacement; old containers receive their full graceful-stop timeout.
 */
export class SurgeDeploymentStrategy implements DeploymentStrategy {
	readonly resourceType = "web";
	readonly name = "surge";

	constructor(
		private readonly routing: IResourceRoutingPolicy,
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
		const { address } = await this.containers.startReady({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
			instanceId: this.generateInstanceId(),
			imageId,
			networkName: network.name,
			resource,
		});
		// A rejected publication can have an uncertain outcome. Keep both revisions
		// alive rather than deleting a replacement that may already receive traffic.
		await this.networking.routeTo(`${resourceId}.${serviceId}`, this.routing.webEndpoint(resource, address));
		if (current.length === 0) return;
		const timeoutSeconds = resource.termination?.timeoutSeconds ?? 30;
		await this.containers.retire(
			serviceId,
			current.map(({ id }) => id),
			timeoutSeconds,
			"Failed to retire previous containers",
		);
	}
}
