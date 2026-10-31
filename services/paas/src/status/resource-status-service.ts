import type { HealthStatus, SyncStatus } from "@homelab-paas/shared-contracts";

import type { IEnvironmentResolver } from "../reconciler/environment-resolver.ts";
import type { IResourceSpecification } from "../reconciler/resource-specification.ts";
import { createLogger } from "../util/logger.ts";
import type { ResourceStatus, ResourceStatusRequest } from "./types.ts";

export interface IResourceStatusService {
	/** Comparison failures yield Unknown; resolved secrets and specifications remain internal. */
	getSync(request: ResourceStatusRequest): Promise<SyncStatus>;
	/** Aggregates immediate resource status independently on each axis. Empty observations are Unknown. */
	aggregate(resources: readonly ResourceStatus[]): ResourceStatus;
}

export class ResourceStatusService implements IResourceStatusService {
	private readonly log = createLogger(ResourceStatusService.name);
	constructor(
		private readonly specification: IResourceSpecification,
		private readonly environment: IEnvironmentResolver,
	) {}

	async getSync(request: ResourceStatusRequest): Promise<SyncStatus> {
		const { serviceId, resourceId, resource, descriptorAvailable, containers } = request;
		if (!descriptorAvailable) return "Unknown";
		if (!resource) return "OutOfSync";
		if (resource.type !== "web" && resource.type !== "worker") return "Unknown";
		try {
			const env = await this.environment.resolve(serviceId, resource.env ?? []);
			const spec = this.specification.get(resourceId, { ...resource, env });
			return containers.length === (resource.replicas ?? 1)
				&& containers.every((container) => container.spec === spec)
				? "Synced"
				: "OutOfSync";
		} catch (err) {
			this.log.error({ err, serviceId, resourceId }, "Cannot compare desired resource configuration");
			return "Unknown";
		}
	}

	aggregate(resources: readonly ResourceStatus[]): ResourceStatus {
		if (!resources.length) return { sync: "Unknown", health: "Unknown" };
		const severity: HealthStatus[] = ["Unknown", "Degraded", "Missing", "Progressing", "Healthy"];
		return {
			sync: resources.some(({ sync }) => sync === "Unknown")
				? "Unknown"
				: resources.some(({ sync }) => sync === "OutOfSync")
					? "OutOfSync"
					: "Synced",
			health: severity.find((status) => resources.some(({ health }) => health === status))!,
		};
	}
}
