import type { HealthStatus } from "@homelab-paas/shared-contracts";

import type { DockerContainerDetails, DockerNetwork, ServiceContainer } from "../docker/types.ts";

export interface HealthDocker {
	listServiceContainers(serviceId: string): Promise<ServiceContainer[]>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
	inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null>;
}

export interface HealthObservation {
	health: HealthStatus;
	signature: string;
}
