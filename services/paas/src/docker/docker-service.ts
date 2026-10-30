import type { ResourceDevice, ResourceHostPort, ResourceLimits, ResourceVolume } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import { DockerClientError } from "./docker-client.ts";
import type { IDockerClient } from "./docker-client.ts";
import type { DockerContainerDetails, DockerNetwork, Labels, ServiceContainer } from "./types.ts";

export interface CreateResourceContainerOptions {
	serviceId: string;
	resourceId: string;
	revision: string;
	spec: string;
	/** Optional unique instance identity for overlapping deployments. */
	instanceId?: string;
	imageId: string;
	command?: string[];
	env?: Record<string, string>;
	volumes?: ResourceVolume[];
	devices?: ResourceDevice[];
	supplementaryGroups?: number[];
	hostPorts?: ResourceHostPort[];
	limits?: ResourceLimits;
}

/** Client failures propagate as DockerClientError. Ownership, identity and
 * infrastructure invariant failures reject with DockerServiceError.
 * Queries include stopped containers. Inspections return null on absence.
 */
export interface IDockerService {
	listServiceContainers(serviceId: string, resourceId?: string): Promise<ServiceContainer[]>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
	readServiceContainerLogs(serviceId: string, containerId: string): Promise<string>;
	inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null>;
	prepareServiceNetwork(serviceId: string): Promise<void>;
	resolveImage(reference: string): Promise<string>;
	createResourceContainer(options: CreateResourceContainerOptions): Promise<string>;
	startServiceContainer(serviceId: string, containerId: string): Promise<void>;
	stopServiceContainer(serviceId: string, containerId: string, timeoutSeconds: number): Promise<void>;
	removeServiceContainer(serviceId: string, containerId: string): Promise<void>;
}

export class DockerServiceError extends Error {
	override readonly name = "DockerServiceError";
	constructor(public readonly kind: "ownership" | "invalid-identity" | "infrastructure" | "not-found") {
		super(`Docker service operation failed (${kind})`);
	}
}

/** Platform conventions and scoped Docker helpers; rollout decisions belong to reconcilers. */
export class DockerService implements IDockerService {
	constructor(
		private readonly client: IDockerClient,
		private readonly config: IPaasConfig,
	) {}

	private labels(serviceId: string): Labels {
		return { "homelab-paas.cluster": this.config.getClusterId(), "homelab-paas.service": serviceId };
	}

	private networkName(serviceId: string): string {
		return `paas-${this.config.getClusterId()}-${serviceId}`;
	}

	private assertOwnership(serviceId: string, labels: Labels): void {
		if (Object.entries(this.labels(serviceId)).some(([key, value]) => labels[key] !== value)) {
			throw new DockerServiceError("ownership");
		}
	}

	async listServiceContainers(serviceId: string, resourceId?: string): Promise<ServiceContainer[]> {
		const labels = this.labels(serviceId);
		if (resourceId !== undefined) labels["homelab-paas.resource"] = resourceId;
		const containers = await this.client.listContainers({ all: true, labels });
		return containers.map((container) => {
			this.assertOwnership(serviceId, container.labels);
			const resource = container.labels["homelab-paas.resource"];
			const revision = container.labels["homelab-paas.revision"];
			const spec = container.labels["homelab-paas.spec"];
			if (!resource || !revision || !spec || (resourceId !== undefined && resource !== resourceId)) {
				throw new DockerServiceError("invalid-identity");
			}
			return {
				id: container.id,
				imageId: container.imageId,
				state: container.state,
				resourceId: resource,
				revision,
				spec,
			};
		});
	}

	async inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null> {
		const container = await this.client.inspectContainer(containerId);
		if (container) this.assertOwnership(serviceId, container.labels);
		return container;
	}

	async inspectServiceNetwork(serviceId: string): Promise<DockerNetwork | null> {
		const network = await this.client.inspectNetwork(this.networkName(serviceId));
		if (network) this.assertOwnership(serviceId, network.labels);
		return network;
	}

	async readServiceContainerLogs(serviceId: string, containerId: string): Promise<string> {
		const container = await this.inspectServiceContainer(serviceId, containerId);
		if (!container) throw new DockerServiceError("not-found");
		return this.config.redact(await this.client.readContainerLogs(containerId), Object.values(container.env ?? {}));
	}

	async prepareServiceNetwork(serviceId: string): Promise<void> {
		const network = await this.inspectServiceNetwork(serviceId);
		const peers: string[] = [];
		for (const role of ["control-plane", "envoy"]) {
			const containers = await this.client.listContainers({
				all: true,
				labels: { "homelab-paas.cluster": this.config.getClusterId(), "homelab-paas.role": role },
			});
			const peer = containers.at(0);
			if (
				containers.length !== 1
				|| !peer
				|| peer.labels["homelab-paas.cluster"] !== this.config.getClusterId()
				|| peer.labels["homelab-paas.role"] !== role
			) {
				throw new DockerServiceError("infrastructure");
			}
			peers.push(peer.id);
		}
		const networkId =
			network?.id
			?? (await this.client.createNetwork({
				name: this.networkName(serviceId),
				driver: "bridge",
				labels: this.labels(serviceId),
			}));
		for (const peer of peers) {
			if (!network?.containerIds.includes(peer)) await this.client.connectNetwork(networkId, peer);
		}
	}

	async resolveImage(reference: string): Promise<string> {
		if (reference.endsWith(":local")) {
			const local = await this.client.inspectImage(reference);
			if (local) return local.id;
		}
		await this.client.pullImage(reference);
		const image = await this.client.inspectImage(reference);
		if (!image) throw new DockerServiceError("not-found");
		return image.id;
	}

	async createResourceContainer(options: CreateResourceContainerOptions): Promise<string> {
		const ownershipGroups = new Map<string, Set<string>>();
		for (const { hostPath, readOnly, ownership } of options.volumes ?? []) {
			if (readOnly || ownership === false) continue;
			const owner = ownership ? `${ownership.uid}:${ownership.gid}` : "1000:1000";
			const paths = ownershipGroups.get(owner) ?? new Set<string>();
			paths.add(hostPath);
			ownershipGroups.set(owner, paths);
		}
		if (ownershipGroups.size) {
			const labels = { "homelab-paas.cluster": this.config.getClusterId(), "homelab-paas.role": "control-plane" };
			const controllers = await this.client.listContainers({ all: false, labels });
			const controller = controllers.at(0);
			if (
				controllers.length !== 1
				|| !controller
				|| Object.entries(labels).some(([key, value]) => controller.labels[key] !== value)
			)
				throw new DockerServiceError("infrastructure");
			for (const [owner, paths] of ownershipGroups) {
				await this.client.prepareVolumeOwnership(
					controller.imageId,
					[...paths],
					{
						"homelab-paas.cluster": this.config.getClusterId(),
						"homelab-paas.owner-service": options.serviceId,
						"homelab-paas.role": "volume-init",
					},
					owner,
				);
			}
		}
		return this.client.createContainer({
			name: `paas-${this.config.getClusterId()}-${options.serviceId}-${options.resourceId}-${options.spec.slice(0, 12)}${options.instanceId ? `-${options.instanceId}` : ""}`,
			image: options.imageId,
			command: options.command,
			env: options.env,
			volumes: options.volumes,
			devices: options.devices,
			supplementaryGroups: options.supplementaryGroups,
			hostPorts: options.hostPorts,
			limits: options.limits,
			labels: {
				...this.labels(options.serviceId),
				"homelab-paas.resource": options.resourceId,
				"homelab-paas.revision": options.revision,
				"homelab-paas.spec": options.spec,
			},
			network: this.networkName(options.serviceId),
			aliases: [options.resourceId],
			restartPolicy: "unless-stopped",
		});
	}

	async startServiceContainer(serviceId: string, containerId: string): Promise<void> {
		const container = await this.inspectServiceContainer(serviceId, containerId);
		if (!container) throw new DockerServiceError("not-found");
		await this.client.startContainer(container.id);
	}

	async stopServiceContainer(serviceId: string, containerId: string, timeoutSeconds: number): Promise<void> {
		const container = await this.inspectServiceContainer(serviceId, containerId);
		if (!container) return;
		try {
			await this.client.stopContainer(container.id, timeoutSeconds);
		} catch (error) {
			if (!(error instanceof DockerClientError && error.kind === "not-found")) throw error;
		}
	}

	async removeServiceContainer(serviceId: string, containerId: string): Promise<void> {
		const container = await this.inspectServiceContainer(serviceId, containerId);
		if (!container) return;
		try {
			await this.client.removeContainer(container.id);
		} catch (error) {
			if (!(error instanceof DockerClientError && error.kind === "not-found")) throw error;
		}
	}
}
