import type { IDockerService } from "../../../docker/docker-service.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { Endpoint } from "../../networking/types.ts";
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
		const containerId = await this.docker.createResourceContainer({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
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
		} catch (error) {
			// A failed replacement must not look converged on the next observation.
			return this.containers.cleanupFailed(
				serviceId,
				[containerId],
				resource.termination?.timeoutSeconds ?? DEFAULT_TERMINATION_TIMEOUT_SEC,
				error,
				"Replacement startup and cleanup failed",
			);
		}
		// Publication may succeed before confirmation fails. Keep the ready container.
		await this.networking.routeTo(`${resourceId}.${serviceId}`, endpoint);
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
