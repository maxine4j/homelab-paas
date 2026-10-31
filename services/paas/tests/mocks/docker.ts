import { z } from "zod";

import { MockHttpServer } from "../util/http-server.ts";

const creation = z.object({
	Image: z.string(),
	Labels: z.record(z.string(), z.string()),
	Env: z.array(z.string()).optional(),
	HostConfig: z.object({ NetworkMode: z.string() }),
});
interface Container {
	Id: string;
	Image: string;
	State: { Running: boolean };
	Config: { Labels: Record<string, string>; Env: string[] };
	NetworkSettings: { Networks: Record<string, { IPAddress: string; Aliases: string[] }> };
}

/** Scenario-specific Engine endpoints, not a general Docker emulator. */
export class MockDocker {
	readonly containers = new Map<string, Container>();
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
				Config: { Labels: { "homelab-paas.cluster": cluster, "homelab-paas.role": role }, Env: [] },
				NetworkSettings: { Networks: {} },
			});
		this.server = new MockHttpServer(({ method, url, body }) => {
			const path = decodeURIComponent(url.pathname.replace(/^\/v1\.48/, ""));
			journal.push(`${method} ${path}`);
			if (method === "GET" && path === "/containers/json") {
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
					Config: { Labels: input.Labels, Env: input.Env ?? [] },
					NetworkSettings: { Networks: { [name]: { IPAddress: "127.0.0.1", Aliases: ["app"] } } },
				});
				this.networks.get(name)!.Containers[id] = {};
				return Response.json({ Id: id }, { status: 201 });
			}
			if (path.startsWith("/containers/")) {
				const id = path.split("/").at(2)!;
				const container = this.containers.get(id);
				if (!container) return new Response(null, { status: 404 });
				if (method === "GET" && path.endsWith("/json")) return Response.json(container);
				if (method === "POST" && path.endsWith("/start")) {
					container.State.Running = true;
					return new Response(null, { status: 204 });
				}
				if (method === "POST" && path.endsWith("/stop")) {
					container.State.Running = false;
					return new Response(null, { status: 204 });
				}
				if (method === "DELETE" && path === `/containers/${id}`) {
					this.containers.delete(id);
					return new Response(null, { status: 204 });
				}
			}
			return undefined;
		});
	}
}
