import { createHash } from "node:crypto";

import type { DockerContainerDetails, DockerNetwork } from "../docker/types.ts";
import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";

export interface IResourceSpecification {
	/** Hashes resolved deployment configuration; revision and runtime health are excluded. */
	get(resourceId: string, resource: DeploymentWebResource | DeploymentWorkerResource): string;
	/** Compares observed mutable settings and attachment/alias, never specification labels or HTTP readiness. */
	matchesRuntime(
		resourceId: string,
		resource: DeploymentWebResource | DeploymentWorkerResource,
		container: DockerContainerDetails | null,
		network: DockerNetwork | null,
	): boolean;
}

export class ResourceSpecification implements IResourceSpecification {
	matchesRuntime(
		resourceId: string,
		resource: DeploymentWebResource | DeploymentWorkerResource,
		container: DockerContainerDetails | null,
		network: DockerNetwork | null,
	): boolean {
		if (!container?.running || !network?.containerIds.includes(container.id)) return false;
		const endpoint = container.networks[network.name];
		if (!container.limits) throw new Error("Live container resource limits are unavailable");
		return Boolean(
			endpoint?.address
			&& endpoint.aliases.includes(resourceId)
			&& container.limits.nanoCpus === Math.round((resource.limits?.cpus ?? 0) * 1e9)
			&& container.limits.memoryBytes === (resource.limits?.memoryMiB ?? 0) * 1048576,
		);
	}

	get(resourceId: string, resource: DeploymentWebResource | DeploymentWorkerResource): string {
		return createHash("sha256")
			.update(
				JSON.stringify([
					resourceId,
					{
						// Property order is part of persisted specification compatibility.
						...(resource.type === "worker" ? { type: "worker" } : {}),
						...this.normalize(resource),
						...(resource.type === "web"
							? { ingress: { public: resource.ingress.public, port: resource.ingress.port } }
							: { healthcheckPort: resource.healthcheckPort }),
						healthcheckUrl: resource.healthcheckUrl ?? null,
						terminationTimeoutSeconds: resource.termination?.timeoutSeconds ?? 30,
					},
				]),
			)
			.digest("hex");
	}

	private normalize(resource: DeploymentWebResource | DeploymentWorkerResource) {
		const env = Object.entries(
			Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return {
			image: resource.image,
			...(resource.selinuxLabeling === false ? { selinuxLabeling: false } : {}),
			...(resource.devices?.length
				? {
						devices: resource.devices.map(({ hostPath, mountPath, permissions }) => ({
							hostPath,
							mountPath,
							permissions: permissions ?? "rwm",
						})),
					}
				: {}),
			...(resource.supplementaryGroups?.length
				? { supplementaryGroups: [...resource.supplementaryGroups].sort((a, b) => a - b) }
				: {}),
			...(resource.hostPorts?.length ? { hostPorts: resource.hostPorts } : {}),
			command: resource.command ?? null,
			env,
			volumes:
				resource.volumes?.map(({ hostPath, mountPath, readOnly, ownership }) => ({
					hostPath,
					mountPath,
					readOnly: readOnly ?? false,
					selinux: "z",
					...(!readOnly && ownership !== false
						? { ownership: ownership ? `${ownership.uid}:${ownership.gid}` : "1000:1000" }
						: {}),
				})) ?? [],
			limits: { cpus: resource.limits?.cpus, memoryMiB: resource.limits?.memoryMiB },
			replicas: resource.replicas ?? 1,
			rolloutStrategy: resource.rolloutStrategy ?? "recreate",
		};
	}
}
