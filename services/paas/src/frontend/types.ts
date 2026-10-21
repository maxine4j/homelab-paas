import type { DockerContainerDetails, ServiceContainer } from "../docker/types.ts";

export interface UiDocker {
	listServiceContainers(serviceId: string, resourceId?: string): Promise<ServiceContainer[]>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
	readServiceContainerLogs(serviceId: string, containerId: string): Promise<string>;
}
