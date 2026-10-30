import type { ResourceDevice, ResourceHostPort, ResourceLimits, ResourceVolume } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import { DockerLogDecoder } from "./docker-log-decoder.ts";
import type { IDockerTransport } from "./docker-transport.ts";
import { DockerClientError } from "./errors.ts";
export { DockerClientError } from "./errors.ts";
import type { DockerContainer, DockerContainerDetails, DockerNetwork, Labels } from "./types.ts";

export interface CreateContainerOptions {
	name: string;
	image: string;
	command?: string[];
	env?: Record<string, string>;
	volumes?: ResourceVolume[];
	devices?: ResourceDevice[];
	supplementaryGroups?: number[];
	hostPorts?: ResourceHostPort[];
	limits?: ResourceLimits;
	labels?: Labels;
	network?: string;
	aliases?: string[];
	restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
}

/** Operations reject with DockerClientError. Inspections return null when absent.
 * Start/stop accept already started/stopped containers. Other missing targets
 * reject with not-found; callers decide whether absence is acceptable.
 */
export interface IDockerClient {
	createNetwork(options: { name: string; driver: string; labels?: Labels }): Promise<string>;
	inspectNetwork(id: string): Promise<DockerNetwork | null>;
	connectNetwork(networkId: string, containerId: string, aliases?: string[]): Promise<void>;
	disconnectNetwork(networkId: string, containerId: string): Promise<void>;
	removeNetwork(id: string): Promise<void>;
	listContainers(options?: { all?: boolean; labels?: Labels }): Promise<DockerContainer[]>;
	inspectContainer(id: string): Promise<DockerContainerDetails | null>;
	/** Returns a completed tail; live follows use IDockerLogClient. */
	readContainerLogs(id: string): Promise<string>;
	/** Nonrecursively assigns source roots to 1000:1000 using a short-lived helper.
	 * The caller supplies a trusted control-plane image and writable source paths.
	 * Rejects on helper failure; cleanup is attempted even after start/wait failure.
	 */
	prepareVolumeOwnership(image: string, hostPaths: string[], labels: Labels): Promise<void>;
	/** Bind mounts use shared SELinux labels; Docker creates missing source directories on start. */
	createContainer(options: CreateContainerOptions): Promise<string>;
	startContainer(id: string): Promise<void>;
	/** Allows the full graceful termination timeout plus five seconds for the Engine response. */
	stopContainer(id: string, timeoutSeconds: number): Promise<void>;
	removeContainer(id: string): Promise<void>;
	inspectImage(reference: string): Promise<{ id: string } | null>;
	pullImage(reference: string): Promise<void>;
}

/** Docker Engine adapter; naming, ownership and deployment policy belong to callers. */
export class DockerClient implements IDockerClient {
	constructor(private readonly transport: IDockerTransport) {}

	private async request(
		method: string,
		path: string,
		body: unknown,
		statuses: number[],
		timeoutMs?: number,
	): Promise<{ status: number; body: string; bytes?: Uint8Array }> {
		let response: { status: number; body: string; bytes?: Uint8Array };
		try {
			response = await this.transport.request(method, path, body, timeoutMs);
		} catch (cause) {
			throw new DockerClientError("unavailable", { cause });
		}
		if (!statuses.includes(response.status)) {
			throw new DockerClientError(
				response.status === 404 ? "not-found" : response.status === 409 ? "conflict" : "unavailable",
				{ cause: new Error(`Docker ${method} ${path} failed: HTTP ${response.status}: ${response.body}`) },
			);
		}
		return response;
	}

	async createNetwork(options: { name: string; driver: string; labels?: Labels }): Promise<string> {
		const response = await this.request(
			"POST",
			"/networks/create",
			{ Name: options.name, Driver: options.driver, Labels: options.labels },
			[201],
		);
		return decode(identity, response.body).Id;
	}

	async readContainerLogs(id: string): Promise<string> {
		const response = await this.request(
			"GET",
			`/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&timestamps=true&tail=200&follow=false`,
			undefined,
			[200],
		);
		if (!response.bytes) throw new DockerClientError("invalid-response");
		const decoder = new DockerLogDecoder(16 * 1024 * 1024);
		return decoder.push(response.bytes) + decoder.end();
	}

	async inspectNetwork(id: string): Promise<DockerNetwork | null> {
		const response = await this.request("GET", `/networks/${encodeURIComponent(id)}`, undefined, [200, 404]);
		if (response.status === 404) return null;
		const data = decode(network, response.body);
		return {
			id: data.Id,
			name: data.Name,
			driver: data.Driver,
			labels: data.Labels,
			containerIds: Object.keys(data.Containers ?? {}),
		};
	}

	async connectNetwork(networkId: string, containerId: string, aliases?: string[]): Promise<void> {
		await this.request(
			"POST",
			`/networks/${encodeURIComponent(networkId)}/connect`,
			{ Container: containerId, EndpointConfig: { Aliases: aliases } },
			[200],
		);
	}

	async disconnectNetwork(networkId: string, containerId: string): Promise<void> {
		await this.request(
			"POST",
			`/networks/${encodeURIComponent(networkId)}/disconnect`,
			{ Container: containerId },
			[200],
		);
	}

	async removeNetwork(id: string): Promise<void> {
		await this.request("DELETE", `/networks/${encodeURIComponent(id)}`, undefined, [204]);
	}

	async listContainers(options: { all?: boolean; labels?: Labels } = {}): Promise<DockerContainer[]> {
		let path = `/containers/json?all=${options.all ?? false}`;
		if (options.labels) {
			const filters = { label: Object.entries(options.labels).map(([key, value]) => `${key}=${value}`) };
			path += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
		}
		const response = await this.request("GET", path, undefined, [200]);
		return decode(containers, response.body).map((data) => ({
			id: data.Id,
			names: data.Names,
			imageId: data.ImageID,
			state: data.State,
			labels: data.Labels,
		}));
	}

	async inspectContainer(id: string): Promise<DockerContainerDetails | null> {
		const response = await this.request("GET", `/containers/${encodeURIComponent(id)}/json`, undefined, [200, 404]);
		if (response.status === 404) return null;
		const data = decode(container, response.body);
		return {
			id: data.Id,
			imageId: data.Image,
			...(data.Mounts
				? {
						mounts: data.Mounts.map((mount) => ({
							type: mount.Type,
							source: mount.Source,
							destination: mount.Destination,
						})),
					}
				: {}),
			running: data.State.Running,
			labels: data.Config.Labels,
			...(data.Config.Env
				? {
						env: Object.fromEntries(
							data.Config.Env.map((entry) => {
								const index = entry.indexOf("=");
								return [entry.slice(0, index), entry.slice(index + 1)];
							}),
						),
					}
				: {}),
			networks: Object.fromEntries(
				Object.entries(data.NetworkSettings.Networks).map(([name, endpoint]) => [
					name,
					{ address: endpoint.IPAddress, aliases: endpoint.Aliases ?? [] },
				]),
			),
		};
	}

	async createContainer(options: CreateContainerOptions): Promise<string> {
		const portBindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
		for (const binding of options.hostPorts ?? []) {
			const key = `${binding.containerPort}/${binding.protocol}`;
			(portBindings[key] ??= []).push({ HostIp: binding.bindAddress, HostPort: String(binding.hostPort) });
		}
		const response = await this.request(
			"POST",
			`/containers/create?name=${encodeURIComponent(options.name)}`,
			{
				Image: options.image,
				Cmd: options.command,
				Env: options.env ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`) : undefined,
				Labels: options.labels,
				ExposedPorts: options.hostPorts?.length
					? Object.fromEntries(Object.keys(portBindings).map((key) => [key, {}]))
					: undefined,
				HostConfig: {
					Devices: options.devices?.map(({ hostPath, mountPath, permissions }) => ({
						PathOnHost: hostPath,
						PathInContainer: mountPath,
						CgroupPermissions: permissions ?? "rwm",
					})),
					GroupAdd: options.supplementaryGroups?.map(String),
					PortBindings: options.hostPorts?.length ? portBindings : undefined,
					Binds: options.volumes?.map(
						({ hostPath, mountPath, readOnly }) => `${hostPath}:${mountPath}:${readOnly ? "ro" : "rw"},z`,
					),
					NanoCpus: options.limits?.cpus === undefined ? undefined : Math.round(options.limits.cpus * 1e9),
					Memory: options.limits?.memoryMiB === undefined ? undefined : options.limits.memoryMiB * 1048576,
					NetworkMode: options.network,
					RestartPolicy: options.restartPolicy ? { Name: options.restartPolicy } : undefined,
				},
				NetworkingConfig: options.network
					? { EndpointsConfig: { [options.network]: { Aliases: options.aliases } } }
					: undefined,
			},
			[201],
		);
		return decode(identity, response.body).Id;
	}

	async prepareVolumeOwnership(image: string, hostPaths: string[], labels: Labels): Promise<void> {
		if (!hostPaths.length) return;
		const response = await this.request(
			"POST",
			"/containers/create",
			{
				Image: image,
				User: "0:0",
				Entrypoint: ["chown"],
				Cmd: ["-h", "1000:1000", ...hostPaths.map((_path, index) => `/volumes/${index}`)],
				Labels: labels,
				HostConfig: {
					Binds: hostPaths.map((hostPath, index) => `${hostPath}:/volumes/${index}:rw,z`),
					NetworkMode: "none",
					ReadonlyRootfs: true,
					CapDrop: ["ALL"],
					CapAdd: ["CHOWN", "DAC_OVERRIDE"],
					SecurityOpt: ["no-new-privileges:true"],
				},
			},
			[201],
		);
		const id = decode(identity, response.body).Id;
		let failure: unknown;
		try {
			await this.startContainer(id);
			const completion = await this.request(
				"POST",
				`/containers/${encodeURIComponent(id)}/wait?condition=not-running`,
				undefined,
				[200],
				30000,
			);
			const result = decode(
				z.object({ StatusCode: z.number().int(), Error: z.object({ Message: z.string() }).optional() }),
				completion.body,
			);
			if (result.StatusCode !== 0 || result.Error?.Message) {
				let diagnostics: string;
				try {
					diagnostics = await this.readContainerLogs(id);
				} catch (cause) {
					throw new DockerClientError("unavailable", {
						cause: new Error(
							`Volume ownership helper failed: exit ${result.StatusCode}; could not read helper diagnostics`,
							{ cause },
						),
					});
				}
				throw new DockerClientError("unavailable", {
					cause: new Error(
						`Volume ownership helper failed: exit ${result.StatusCode}: ${result.Error?.Message ?? ""}\n${diagnostics}`,
					),
				});
			}
		} catch (cause) {
			failure = cause;
		}
		try {
			await this.request("DELETE", `/containers/${encodeURIComponent(id)}?force=true`, undefined, [204, 404]);
		} catch (cause) {
			throw failure
				? new DockerClientError("unavailable", {
						cause: new AggregateError([failure, cause], "Volume helper execution and cleanup failed"),
					})
				: cause;
		}
		if (failure) throw failure;
	}

	async startContainer(id: string): Promise<void> {
		await this.request("POST", `/containers/${encodeURIComponent(id)}/start`, undefined, [204, 304]);
	}

	async stopContainer(id: string, timeoutSeconds: number): Promise<void> {
		await this.request(
			"POST",
			`/containers/${encodeURIComponent(id)}/stop?t=${encodeURIComponent(timeoutSeconds)}`,
			undefined,
			[204, 304],
			(timeoutSeconds + 5) * 1000,
		);
	}

	async removeContainer(id: string): Promise<void> {
		await this.request("DELETE", `/containers/${encodeURIComponent(id)}`, undefined, [204]);
	}

	async inspectImage(reference: string): Promise<{ id: string } | null> {
		const response = await this.request(
			"GET",
			`/images/${encodeURIComponent(reference)}/json`,
			undefined,
			[200, 404],
		);
		return response.status === 404 ? null : { id: decode(identity, response.body).Id };
	}

	async pullImage(reference: string): Promise<void> {
		const response = await this.request(
			"POST",
			`/images/create?fromImage=${encodeURIComponent(reference)}`,
			undefined,
			[200],
		);
		for (const line of response.body.split("\n").filter((value) => value.trim())) {
			const event = decode(pullEvent, line);
			if (event.error !== undefined || event.errorDetail !== undefined)
				throw new DockerClientError("unavailable", { cause: new Error(`Docker image pull failed: ${line}`) });
		}
	}
}

const identity = z.object({ Id: z.string().min(1) });
const labels = z
	.record(z.string(), z.string())
	.nullable()
	.transform((value) => value ?? {});
const containers = z.array(
	z.object({
		Id: z.string().min(1),
		Names: z.array(z.string()),
		ImageID: z.string().min(1),
		State: z.string(),
		Labels: labels,
	}),
);
const network = z.object({
	Id: z.string().min(1),
	Name: z.string(),
	Driver: z.string(),
	Labels: labels,
	Containers: z.record(z.string(), z.object({})).nullish(),
});
const container = z.object({
	Id: z.string().min(1),
	Image: z.string().min(1),
	State: z.object({ Running: z.boolean() }),
	Config: z.object({ Labels: labels, Env: z.array(z.string().includes("=")).nullish() }),
	Mounts: z
		.array(z.object({ Type: z.string(), Source: z.string().default(""), Destination: z.string().startsWith("/") }))
		.optional(),
	NetworkSettings: z.object({
		Networks: z.record(
			z.string(),
			z.object({
				IPAddress: z.string(),
				Aliases: z.array(z.string()).nullable(),
			}),
		),
	}),
});
const pullEvent = z.object({ error: z.string().optional(), errorDetail: z.object({}).optional() });

function decode<T>(schema: z.ZodType<T>, body: string): T {
	try {
		return schema.parse(JSON.parse(body));
	} catch (cause) {
		throw new DockerClientError("invalid-response", { cause });
	}
}
