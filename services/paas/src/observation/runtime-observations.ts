import type { DockerContainerDetails, DockerNetwork, ServiceContainer } from "../docker/types.ts";

export interface IObservationInvalidation {
	/** Starts a fresh observation generation; old in-flight reads cannot populate it. */
	invalidate(serviceId?: string): void;
}

export interface IObservationDocker {
	listServiceContainers(serviceId: string, resourceId?: string): Promise<ServiceContainer[]>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
	inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null>;
	readServiceContainerLogs(serviceId: string, containerId: string): Promise<string>;
}

export interface IRuntimeObservations extends IObservationDocker, IObservationInvalidation {}

interface ServiceObservation {
	expiresAt: number;
	containers: Map<string, Promise<ServiceContainer[]>>;
	details: Map<string, Promise<DockerContainerDetails | null>>;
	network: Map<string, Promise<DockerNetwork | null>>;
}

/** Observational reads only. Deployment readiness and ownership operations use Docker directly. */
export class RuntimeObservations implements IRuntimeObservations {
	private readonly services = new Map<string, ServiceObservation>();
	private readonly immutable = new Map<string, DockerContainerDetails>();
	constructor(
		private readonly docker: IObservationDocker,
		private readonly now: () => number,
	) {}
	invalidate(serviceId?: string): void {
		if (serviceId === undefined) this.services.clear();
		else this.services.delete(serviceId);
	}
	async listServiceContainers(serviceId: string, resourceId?: string): Promise<ServiceContainer[]> {
		const containers = await this.read(
			serviceId,
			"all",
			(scope) => scope.containers,
			() => this.docker.listServiceContainers(serviceId),
		);
		return resourceId === undefined
			? containers
			: containers.filter((container) => container.resourceId === resourceId);
	}
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null> {
		return this.read(
			serviceId,
			containerId,
			(scope) => scope.details,
			async () => {
				const current = await this.docker.inspectServiceContainer(serviceId, containerId);
				if (!current) {
					this.immutable.delete(containerId);
					return null;
				}
				let immutable = this.immutable.get(containerId);
				if (!immutable) {
					immutable = structuredClone(current);
					if (this.immutable.size >= 2048) this.immutable.delete(this.immutable.keys().next().value!);
					this.immutable.set(containerId, immutable);
				}
				return {
					...current,
					imageId: immutable.imageId,
					labels: immutable.labels,
					env: immutable.env,
					mounts: immutable.mounts,
				};
			},
		);
	}
	inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null> {
		return this.read(
			serviceId,
			"network",
			(scope) => scope.network,
			() => this.docker.inspectServiceNetwork(serviceId),
		);
	}
	readServiceContainerLogs(serviceId: string, containerId: string): Promise<string> {
		return this.docker.readServiceContainerLogs(serviceId, containerId);
	}

	private scope(serviceId: string): ServiceObservation {
		let scope = this.services.get(serviceId);
		if (!scope || scope.expiresAt <= this.now()) {
			scope = { expiresAt: this.now() + 30_000, containers: new Map(), details: new Map(), network: new Map() };
			if (this.services.size >= 1024) this.services.delete(this.services.keys().next().value!);
			this.services.set(serviceId, scope);
		}
		return scope;
	}

	private async read<T>(
		serviceId: string,
		key: string,
		cache: (scope: ServiceObservation) => Map<string, Promise<T>>,
		load: () => Promise<T>,
	): Promise<T> {
		const scope = this.scope(serviceId);
		const entries = cache(scope);
		let pending = entries.get(key);
		if (!pending) {
			pending = load().then((value) => structuredClone(value));
			entries.set(key, pending);
		}
		try {
			const result = await pending;
			if (this.services.get(serviceId) !== scope) return this.read(serviceId, key, cache, load);
			return structuredClone(result);
		} catch (error) {
			if (this.services.get(serviceId) !== scope) return this.read(serviceId, key, cache, load);
			throw error;
		}
	}
}
