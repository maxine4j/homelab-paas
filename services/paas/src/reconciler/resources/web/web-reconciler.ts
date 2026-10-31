import type { IDockerService } from "../../../docker/docker-service.ts";
import type { HttpProbe } from "../../../util/healthcheck.ts";
import { createLogger } from "../../../util/logger.ts";
import type { IDeploymentService } from "../../deployment/deployment-service.ts";
import type { DeploymentWebResource } from "../../deployment/strategy/types.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { IResourceSpecification } from "../../resource-specification.ts";

export interface WebReconciliationRequest {
	force?: boolean;
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
	private readonly log = createLogger(WebResourceReconciler.name);
	readonly type = "web";
	readonly lifecycle = "deployment";

	constructor(
		private readonly specification: IResourceSpecification,
		private readonly docker: IDockerService,
		private readonly deployment: IDeploymentService,
		private readonly networking: INetworkingService,
		private readonly probe: HttpProbe,
	) {}

	async reconcile(request: WebReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const spec = this.specification.get(resourceId, resource);
		const containers = await this.docker.listServiceContainers(serviceId, resourceId);
		const current = containers.at(0);

		if (!request.force && containers.length === 1 && current?.spec === spec && current.state === "running") {
			const network = await this.docker.inspectServiceNetwork(serviceId);
			const container = await this.docker.inspectServiceContainer(serviceId, current.id);
			const address = network && container?.networks[network.name]?.address;
			if (network && container?.running && network.containerIds.includes(container.id) && address) {
				// A restarted control plane may need attaching to an existing service network.
				await this.docker.prepareServiceNetwork(serviceId);
				const endpoint = {
					address,
					port: resource.ingress.port,
					healthcheckPath: resource.healthcheckUrl ?? undefined,
					public: resource.ingress.public ?? false,
					primary: resource.primary ?? true,
				};
				if (
					endpoint.healthcheckPath
					&& !(await this.probe(endpoint.address, endpoint.port, endpoint.healthcheckPath))
				)
					throw new Error(
						`Container readiness failed: HTTP health check on port ${endpoint.port} at ${endpoint.healthcheckPath} did not pass`,
					);
				await this.networking.routeTo(`${resourceId}.${serviceId}`, endpoint);
				return;
			}
		}

		let reason = "network-drift";
		if (!current) reason = "missing";
		else if (containers.length !== 1) reason = "duplicates";
		else if (current.spec !== spec) reason = "specification-changed";
		else if (current.state !== "running") reason = "not-running";
		if (request.force) reason = "manual-redeploy";
		this.log.info(
			{
				event: "resource.drift",
				serviceId,
				resourceId,
				revision: request.revision,
				reason,
				strategy: resource.rolloutStrategy ?? "recreate",
			},
			"Detected web resource drift; deploying replacement",
		);
		await this.deployment.deploy({ ...request, spec });
	}
}
