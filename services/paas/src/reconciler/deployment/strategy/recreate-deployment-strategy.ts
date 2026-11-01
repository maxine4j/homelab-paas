import type { IDockerService } from "../../../docker/docker-service.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { IDeploymentContainers } from "../deployment-containers.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./types.ts";

const DEFAULT_TERMINATION_TIMEOUT_SEC = 30;

/** Recreate owns replacement sequencing; callers own serialization and retries. */
export class RecreateDeploymentStrategy implements DeploymentStrategy {
	readonly name = "recreate";

	constructor(
		private readonly docker: IDockerService,
		private readonly networking: INetworkingService,
		private readonly containers: IDeploymentContainers,
	) {}

	async deploy(request: DeploymentRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const current = await this.docker.listServiceContainers(serviceId, resourceId);
		const imageId = await this.docker.resolveImage(resource.image);
		await this.docker.prepareServiceNetwork(serviceId);
		const network = await this.docker.inspectServiceNetwork(serviceId);
		if (!network) throw new Error("Service network is unavailable");
		await this.networking.withdraw(`${resourceId}.${serviceId}`);
		await this.containers.retire(
			serviceId,
			current.map(({ id }) => id),
			resource.termination?.timeoutSeconds ?? DEFAULT_TERMINATION_TIMEOUT_SEC,
			"Container retirement failed",
		);
		const { address } = await this.containers.startReady({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
			imageId,
			networkName: network.name,
			resource,
		});
		// Publication may succeed before confirmation fails. Keep the ready container.
		await this.networking.routeTo(`${resourceId}.${serviceId}`, {
			address,
			port: resource.ingress.port,
			healthcheckPath: resource.healthcheckUrl ?? undefined,
			public: resource.ingress.public ?? false,
			primary: resource.primary ?? true,
		});
	}
}
