import { createHash } from "node:crypto";

import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";

export interface IResourceSpecification {
	/** Hashes resolved deployment configuration; revision and runtime health are excluded. */
	get(resourceId: string, resource: DeploymentWebResource | DeploymentWorkerResource): string;
}

export class ResourceSpecification implements IResourceSpecification {
	get(resourceId: string, resource: DeploymentWebResource | DeploymentWorkerResource): string {
		return resource.type === "web" ? this.web(resourceId, resource) : this.worker(resourceId, resource);
	}
	private web(resourceId: string, resource: DeploymentWebResource): string {
		const env = Object.entries(
			Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return createHash("sha256")
			.update(
				JSON.stringify([
					resourceId,
					{
						image: resource.image,
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
						ingress: { public: resource.ingress.public, port: resource.ingress.port },
						healthcheckUrl: resource.healthcheckUrl ?? null,
						terminationTimeoutSeconds: resource.termination?.timeoutSeconds ?? 30,
					},
				]),
			)
			.digest("hex");
	}
	private worker(resourceId: string, resource: DeploymentWorkerResource): string {
		const env = Object.entries(
			Object.fromEntries((resource.env ?? []).map(({ name, value }) => [name, value])),
		).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return createHash("sha256")
			.update(
				JSON.stringify([
					resourceId,
					{
						type: "worker",
						image: resource.image,
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
						healthcheckPort: resource.healthcheckPort,
						healthcheckUrl: resource.healthcheckUrl ?? null,
						terminationTimeoutSeconds: resource.termination?.timeoutSeconds ?? 30,
					},
				]),
			)
			.digest("hex");
	}
}
