import { z } from "zod";

import { MockHttpServer } from "../util/http-server.ts";

const creation = z.object({
	Image: z.string(),
	Labels: z.record(z.string(), z.string()),
	Env: z.array(z.string()).optional(),
	HostConfig: z.object({ NetworkMode: z.string(), NanoCpus: z.number().default(0), Memory: z.number().default(0) }),
	NetworkingConfig: z.object({ EndpointsConfig: z.record(z.string(), z.object({ Aliases: z.array(z.string()) })) }),
});
interface Container {
	Id: string;
	Image: string;
	State: { Running: boolean };
	HostConfig: { NanoCpus: number; Memory: number };
	Config: { Labels: Record<string, string>; Env: string[] };
	NetworkSettings: { Networks: Record<string, { IPAddress: string; Aliases: string[] }> };
}

/** Scenario-specific Engine endpoints, not a general Docker emulator. */
export class MockDocker {
	readonly containers = new Map<string, Container>();
	eventConnections = 0;
	beforeInventory: (() => Promise<void>) | undefined;
	private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
	private readonly networks = new Map<
		string,
		{ Id: string; Name: string; Driver: string; Labels: Record<string, string>; Containers: Record<string, object> }
	>();
	private nextId = 0;
	readonly server: MockHttpServer;
	constructor(cluster: string, journal: string[]) {
		for (const role of ["control-plane", "envoy"])
			this.containers.set(role, {
				Id: role,
				Image: "infrastructure",
				State: { Running: true },
				HostConfig: { NanoCpus: 0, Memory: 0 },
				Config: { Labels: { "homelab-paas.cluster": cluster, "homelab-paas.role": role }, Env: [] },
				NetworkSettings: { Networks: {} },
			});
		this.server = new MockHttpServer(async ({ method, url, body }) => {
			const path = decodeURIComponent(url.pathname.replace(/^\/v1\.48/, ""));
			journal.push(`${method} ${path}`);
			if (method === "GET" && path === "/events") {
				this.eventConnections++;
				let streamController: ReadableStreamDefaultController<Uint8Array>;
				return new Response(
					new ReadableStream<Uint8Array>({
						start: (controller) => {
							streamController = controller;
							this.streams.add(controller);
						},
						cancel: () => {
							this.streams.delete(streamController);
						},
					}),
				);
			}
			if (method === "GET" && path === "/containers/json") {
				const gate = this.beforeInventory;
				this.beforeInventory = undefined;
				await gate?.();
				const filters = z
					.object({ label: z.array(z.string()) })
					.parse(JSON.parse(url.searchParams.get("filters")!));
				return Response.json(
					[...this.containers.values()]
						.filter((c) =>
							filters.label.every((label) => {
								const index = label.indexOf("=");
								return c.Config.Labels[label.slice(0, index)] === label.slice(index + 1);
							}),
						)
						.map((c) => ({
							Id: c.Id,
							ImageID: c.Image,
							Names: [`/${c.Id}`],
							State: c.State.Running ? "running" : "exited",
							Labels: c.Config.Labels,
						})),
				);
			}
			if (method === "GET" && path.startsWith("/images/") && path.endsWith("/json"))
				return Response.json({ Id: "sha256:test-image" });
			if (method === "POST" && path === "/networks/create") {
				const input = z
					.object({ Name: z.string(), Driver: z.string(), Labels: z.record(z.string(), z.string()) })
					.parse(JSON.parse(body));
				this.networks.set(input.Name, { ...input, Id: input.Name, Containers: {} });
				return Response.json({ Id: input.Name }, { status: 201 });
			}
			if (path.startsWith("/networks/")) {
				const name = path.split("/").at(2)!;
				const network = this.networks.get(name);
				if (method === "GET") return network ? Response.json(network) : new Response(null, { status: 404 });
				if (method === "POST" && path.endsWith("/connect") && network) {
					const { Container, EndpointConfig } = z
						.object({
							Container: z.string(),
							EndpointConfig: z.object({ Aliases: z.array(z.string()).optional() }),
						})
						.parse(JSON.parse(body));
					network.Containers[Container] = {};
					this.containers.get(Container)!.NetworkSettings.Networks[name] = {
						IPAddress: "127.0.0.1",
						Aliases: EndpointConfig.Aliases ?? [],
					};
					this.emit("network", "connect", network.Id, { container: Container });
					return Response.json({});
				}
			}
			if (method === "POST" && path === "/containers/create") {
				const input = creation.parse(JSON.parse(body));
				const id = `workload-${++this.nextId}`;
				const name = input.HostConfig.NetworkMode;
				this.containers.set(id, {
					Id: id,
					Image: input.Image,
					State: { Running: false },
					HostConfig: { NanoCpus: input.HostConfig.NanoCpus, Memory: input.HostConfig.Memory },
					Config: { Labels: input.Labels, Env: input.Env ?? [] },
					NetworkSettings: {
						Networks: {
							[name]: {
								IPAddress: "127.0.0.1",
								Aliases: input.NetworkingConfig.EndpointsConfig[name]!.Aliases,
							},
						},
					},
				});
				this.networks.get(name)!.Containers[id] = {};
				this.emit("container", "create", id, input.Labels);
				return Response.json({ Id: id }, { status: 201 });
			}
			if (path.startsWith("/containers/")) {
				const id = path.split("/").at(2)!;
				const container = this.containers.get(id);
				if (!container) return new Response(null, { status: 404 });
				if (method === "GET" && path.endsWith("/json")) return Response.json(container);
				if (method === "POST" && path.endsWith("/start")) {
					container.State.Running = true;
					this.emit("container", "start", id, container.Config.Labels);
					return new Response(null, { status: 204 });
				}
				if (method === "POST" && path.endsWith("/stop")) {
					container.State.Running = false;
					this.emit("container", "die", id, container.Config.Labels);
					return new Response(null, { status: 204 });
				}
				if (method === "DELETE" && path === `/containers/${id}`) {
					this.containers.delete(id);
					this.emit("container", "destroy", id, container.Config.Labels);
					return new Response(null, { status: 204 });
				}
			}
			return undefined;
		});
	}

	emit(type: "container" | "network", action: string, id: string, attributes: Record<string, string>): void {
		const bytes = Buffer.from(
			JSON.stringify({ Type: type, Action: action, Actor: { ID: id, Attributes: attributes } }) + "\n",
		);
		for (const controller of this.streams) {
			controller.enqueue(bytes.subarray(0, 17));
			controller.enqueue(bytes.subarray(17));
		}
	}

	disconnectEvents(): void {
		for (const controller of this.streams) controller.close();
		this.streams.clear();
	}
}
