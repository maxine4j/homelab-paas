import type { HealthStatus, Resource, SyncStatus } from "@homelab-paas/shared-contracts";

import type { ServiceContainer } from "../docker/types.ts";

export interface ResourceStatusRequest {
	serviceId: string;
	resourceId: string;
	resource?: Resource;
	descriptorAvailable: boolean;
	containers: readonly ServiceContainer[];
}

export interface ResourceStatus {
	sync: SyncStatus;
	health: HealthStatus;
}
