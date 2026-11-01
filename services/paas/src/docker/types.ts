export type Labels = Record<string, string>;

export interface ClusterWorkload {
	id: string;
	serviceId: string;
}

/** Invalidation hint only; consumers must freshly inspect before repairing. */
export interface DockerEvent {
	type: "container" | "network";
	action: string;
	id: string;
	attributes: Labels;
}

export interface DockerContainer {
	id: string;
	names: string[];
	imageId: string;
	state: string;
	labels: Labels;
}

export interface DockerContainerDetails {
	/** Fresh live mutable Engine settings, independent of specification labels. */
	limits?: { nanoCpus: number; memoryBytes: number };
	/** Internal mount metadata; never return wholesale in UI snapshots. */
	mounts?: { type: string; source: string; destination: string }[];
	/** Internal only; never serialize environment in status responses. */
	env?: Record<string, string>;
	id: string;
	imageId: string;
	running: boolean;
	labels: Labels;
	networks: Record<string, { address: string; aliases: string[] }>;
}

export interface HostPathDocker {
	listContainers(options: { all: boolean; labels: Labels }): Promise<DockerContainer[]>;
	inspectContainer(id: string): Promise<DockerContainerDetails | null>;
}

export interface DockerNetwork {
	id: string;
	name: string;
	driver: string;
	labels: Labels;
	containerIds: string[];
}

export interface ServiceContainer {
	id: string;
	resourceId: string;
	revision: string;
	spec: string;
	imageId: string;
	state: string;
}
