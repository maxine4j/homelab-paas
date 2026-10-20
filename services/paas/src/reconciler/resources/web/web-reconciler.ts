import { createHash } from "node:crypto";

import type { WebResource } from "@homelab-paas/shared-contracts";
import type { Logger } from "pino";

import type { IDockerService } from "../../../docker/docker-service.ts";
import type { IDeploymentService } from "../../deployment/deployment-service.ts";

export interface WebReconciliationRequest {
	serviceId: string;
	resourceId: string;
	revision: string;
	/** Validated resource from the desired service descriptor. */
	resource: WebResource;
}

export interface IWebResourceReconciler {
	readonly type: "web";
	readonly lifecycle: "deployment";
	/** Observe actual state and request deployment on drift. Failures propagate. */
	reconcile(request: WebReconciliationRequest): Promise<void>;
}

/** Detects drift; deployment services own all mutations and rollout sequencing. */
export class WebResourceReconciler implements IWebResourceReconciler {
	readonly type = "web";
	readonly lifecycle = "deployment";

	constructor(
		private readonly docker: IDockerService,
		private readonly deployment: IDeploymentService,
		private readonly logger: Logger,
	) {}

	async reconcile(request: WebReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, resource } = request;
		const spec = this.fingerprint(resourceId, resource);
		const containers = await this.docker.listServiceContainers(serviceId, resourceId);
		const current = containers.at(0);

		if (containers.length === 1 && current?.spec === spec && current.state === "running") {
			const network = await this.docker.inspectServiceNetwork(serviceId);
			const container = await this.docker.inspectServiceContainer(serviceId, current.id);
			if (
				network
				&& container?.running
				&& network.containerIds.includes(container.id)
				&& container.networks[network.name]?.address
			)
				return;
		}

		this.logger.info({ serviceId, resourceId }, "Detected drift for web resource");
		await this.deployment.deploy({ ...request, spec });
	}

	private fingerprint(resourceId: string, resource: WebResource): string {
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
