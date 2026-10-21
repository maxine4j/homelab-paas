export type Labels = Record<string, string>;

export interface DockerContainer {
	id: string;
	names: string[];
	imageId: string;
	state: string;
	labels: Labels;
}

export interface DockerContainerDetails {
	/** Internal only; never serialize environment in status responses. */
	env?: Record<string, string>;
	id: string;
	imageId: string;
	running: boolean;
	labels: Labels;
	networks: Record<string, { address: string; aliases: string[] }>;
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
