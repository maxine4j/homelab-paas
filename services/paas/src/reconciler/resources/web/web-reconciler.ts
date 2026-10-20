import { createHash } from "node:crypto";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import { logger } from "../../../util/logger.ts";
import type { IDeploymentService } from "../../deployment/deployment-service.ts";
import type { DeploymentWebResource } from "../../deployment/strategy/types.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";

export interface WebReconciliationRequest {
	serviceId: string;
	resourceId: string;
	revision: string;
	/** Validated resource from the desired service descriptor. */
	resource: DeploymentWebResource;
}

export interface IWebResourceReconciler {
	readonly type: "web";
	readonly lifecycle: "deployment";
	/** Observe actual state and request deployment on drift. Failures propagate. */
	reconcile(request: WebReconciliationRequest): Promise<void>;
}

/** Repairs connectivity and routing; deployment services own workload rollout. */
export class WebResourceReconciler implements IWebResourceReconciler {
	readonly type = "web";
	readonly lifecycle = "deployment";

	constructor(
		private readonly docker: IDockerService,
		private readonly deployment: IDeploymentService,
		private readonly networking: INetworkingService,
		private readonly probe: HttpProbe,
	) {}

	async reconcile(request: WebReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const spec = this.fingerprint(resourceId, resource);
		const containers = await this.docker.listServiceContainers(serviceId, resourceId);
		const current = containers.at(0);

		if (containers.length === 1 && current?.spec === spec && current.state === "running") {
			const network = await this.docker.inspectServiceNetwork(serviceId);
			const container = await this.docker.inspectServiceContainer(serviceId, current.id);
			const address = network && container?.networks[network.name]?.address;
			if (network && container?.running && network.containerIds.includes(container.id) && address) {
				// A restarted control plane may need attaching to an existing service network.
				await this.docker.prepareServiceNetwork(serviceId);
				const endpoint = {
					address,
					port: resource.ingress.port,
					healthcheckPath: resource.healthcheckUrl ?? "/healthcheck",
					public: resource.ingress.public ?? false,
				};
				if (!(await this.probe(endpoint.address, endpoint.port, endpoint.healthcheckPath)))
					throw new Error("Container readiness failed; check healthcheckUrl");
				await this.networking.routeTo(serviceId, endpoint);
				return;
			}
		}

		logger.info({ serviceId, resourceId }, "Detected drift for web resource");
		await this.deployment.deploy({ ...request, spec });
	}

	private fingerprint(resourceId: string, resource: DeploymentWebResource): string {
		const env = Object.entries(
			Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return createHash("sha256")
			.update(
				JSON.stringify([
					resourceId,
					{
						image: resource.image,
						command: resource.command ?? null,
						env,
						replicas: resource.replicas ?? 1,
						rolloutStrategy: resource.rolloutStrategy ?? "recreate",
						ingress: { public: resource.ingress.public, port: resource.ingress.port },
						healthcheckUrl: resource.healthcheckUrl ?? "/healthcheck",
						terminationTimeoutSeconds: resource.termination?.timeoutSeconds ?? 30,
					},
				]),
			)
			.digest("hex");
	}
}
