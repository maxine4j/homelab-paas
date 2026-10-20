import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import type { ISleep } from "../../../util/sleep.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { Endpoint } from "../../networking/types.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./types.ts";

const DEFAULT_TERMINATION_TIMEOUT_SEC = 30;
const DEFAULT_HEALTHCHECK_URL = "/healthcheck";
const MAX_STARTUP_PROBE_ATTEMPTS = 30;

/** Recreate owns replacement sequencing; callers own serialization and retries. */
export class RecreateDeploymentStrategy implements DeploymentStrategy {
	readonly name = "recreate";

	constructor(
		private readonly docker: IDockerService,
		private readonly networking: INetworkingService,
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
		await this.networking.withdraw(serviceId);
		const retirements = await Promise.allSettled(
			current.map(async (container) => {
				await this.docker.stopServiceContainer(
					serviceId,
					container.id,
					resource.termination?.timeoutSeconds ?? DEFAULT_TERMINATION_TIMEOUT_SEC,
				);
				await this.docker.removeServiceContainer(serviceId, container.id);
			}),
		);
		const failures: unknown[] = retirements.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length > 0) throw new AggregateError(failures, "Container retirement failed");
		const containerId = await this.docker.createResourceContainer({
			serviceId,
			resourceId,
			revision: request.revision,
			spec: request.spec,
			imageId,
			command: resource.command,
			env: Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		});
		let endpoint: Endpoint;
		try {
			await this.docker.startServiceContainer(serviceId, containerId);
			endpoint = await this.waitReady(request, containerId, network.name);
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
		// Publication may succeed before confirmation fails. Keep the ready container.
		await this.networking.routeTo(serviceId, endpoint);
	}

	private async waitReady(request: DeploymentRequest, containerId: string, networkName: string): Promise<Endpoint> {
		const { serviceId, resource } = request;
		for (let attempt = 0; attempt < MAX_STARTUP_PROBE_ATTEMPTS; attempt++) {
			const container = await this.docker.inspectServiceContainer(serviceId, containerId);
			const address = container?.networks[networkName]?.address;
			if (container?.running && address) {
				const endpoint: Endpoint = {
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
