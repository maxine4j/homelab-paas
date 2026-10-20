import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import type { ISleep } from "../../../util/sleep.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./types.ts";

const DEFAULT_TERMINATION_TIMEOUT_SEC = 30;
const DEFAULT_HEALTHCHECK_URL = "/health";
const MAX_STARTUP_PROBE_ATTEMPTS = 30;

export interface WebEndpoint {
	address: string;
	port: number;
	healthcheckPath: string;
}

/** Persists and publishes routes; withdrawal must complete before containers stop. */
export interface IDeploymentRoutes {
	set(serviceId: string, endpoint: WebEndpoint | undefined): Promise<void>;
}

/** Recreate owns replacement sequencing; callers own serialization and retries. */
export class RecreateDeploymentStrategy implements DeploymentStrategy {
	readonly name = "recreate";

	constructor(
		private readonly docker: IDockerService,
		private readonly routes: IDeploymentRoutes,
		private readonly probe: HttpProbe,
		private readonly sleep: ISleep,
	) {}

	async deploy(request: DeploymentRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const current = await this.docker.listServiceContainers(serviceId, resourceId);
		const imageId = await this.docker.resolveImage(resource.image);
		await this.docker.prepareServiceNetwork(serviceId);
		const network = await this.docker.inspectServiceNetwork(serviceId);
		if (!network) throw new Error("Service network is unavailable");
		await this.routes.set(serviceId, undefined);
		await Promise.allSettled(
			current.map(async (container) => {
				await this.docker.stopServiceContainer(
					serviceId,
					container.id,
					resource.termination?.timeoutSeconds ?? DEFAULT_TERMINATION_TIMEOUT_SEC,
				);
				await this.docker.removeServiceContainer(serviceId, container.id);
			}),
		);
		const containerId = await this.docker.createResourceContainer({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
			imageId,
			command: resource.command,
			env: Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		});
		try {
			await this.docker.startServiceContainer(serviceId, containerId);
			const endpoint = await this.waitReady(request, containerId, network.name);
			await this.routes.set(serviceId, endpoint);
		} catch (error) {
			// A failed replacement must not look converged on the next observation.
			try {
				await this.docker.stopServiceContainer(
					serviceId,
					containerId,
					resource.termination?.timeoutSeconds ?? 30,
				);
			} finally {
				await this.docker.removeServiceContainer(serviceId, containerId);
			}
			throw error;
		}
	}

	private async waitReady(
		request: DeploymentRequest,
		containerId: string,
		networkName: string,
	): Promise<WebEndpoint> {
		const { serviceId, resource } = request;
		for (let attempt = 0; attempt < MAX_STARTUP_PROBE_ATTEMPTS; attempt++) {
			const container = await this.docker.inspectServiceContainer(serviceId, containerId);
			const address = container?.networks[networkName]?.address;
			if (container?.running && address) {
				const endpoint: WebEndpoint = {
					address,
					port: resource.ingress.port,
					healthcheckPath: resource.healthcheckUrl ?? DEFAULT_HEALTHCHECK_URL,
				};
				if (await this.probe(endpoint.address, endpoint.port, endpoint.healthcheckPath)) return endpoint;
			}
			if (attempt < 29) await this.sleep(1000);
		}
		throw new Error("Container readiness failed; check container startup and healthcheckUrl");
	}
}
