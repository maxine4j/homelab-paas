import { expect, test } from "vitest";

import { DockerClient, DockerClientError } from "./docker-client.ts";
import type { IDockerTransport } from "./docker-transport.ts";

function fixture(status = 200, data: unknown = {}, raw?: string) {
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const transport: IDockerTransport = {
		async request(method, path, body) {
			calls.push({ method, path, body });
			return { status, body: raw ?? JSON.stringify(data) };
		},
	};
	return { client: new DockerClient(transport), calls };
}

test("creates networks with caller-supplied names, drivers and labels", async () => {
	const f = fixture(201, { Id: "network" });
	expect(await f.client.createNetwork({ name: "custom", driver: "bridge", labels: { owner: "test" } })).toBe(
		"network",
	);
	expect(f.calls).toEqual([
		{
			method: "POST",
			path: "/networks/create",
			body: { Name: "custom", Driver: "bridge", Labels: { owner: "test" } },
		},
	]);
});

test("inspects networks into plain values and handles null attachments", async () => {
	const f = fixture(200, {
		Id: "n",
		Name: "custom",
		Driver: "bridge",
		Labels: null,
		Containers: { c: { Name: "app" } },
	});
	expect(await f.client.inspectNetwork("name/a")).toEqual({
		id: "n",
		name: "custom",
		driver: "bridge",
		labels: {},
		containerIds: ["c"],
	});
	expect(f.calls.at(0)?.path).toBe("/networks/name%2Fa");
	expect(
		await fixture(200, {
			Id: "n",
			Name: "custom",
			Driver: "bridge",
			Labels: {},
			Containers: null,
		}).client.inspectNetwork("n"),
	).toMatchObject({ containerIds: [] });
});

test("connects, disconnects and removes networks separately", async () => {
	const f = fixture();
	await f.client.connectNetwork("n/a", "c", ["app"]);
	await f.client.disconnectNetwork("n/a", "c");
	expect(f.calls).toEqual([
		{
			method: "POST",
			path: "/networks/n%2Fa/connect",
			body: { Container: "c", EndpointConfig: { Aliases: ["app"] } },
		},
		{ method: "POST", path: "/networks/n%2Fa/disconnect", body: { Container: "c" } },
	]);
	const removed = fixture(204);
	await removed.client.removeNetwork("n/a");
	expect(removed.calls).toEqual([{ method: "DELETE", path: "/networks/n%2Fa", body: undefined }]);
});

test("lists running containers by default with optional stopped containers and label filters", async () => {
	const f = fixture(200, [{ Id: "c", Names: ["/app"], ImageID: "sha256:a", State: "exited", Labels: null }]);
	expect(await f.client.listContainers({ all: true, labels: { owner: "a&b" } })).toEqual([
		{ id: "c", names: ["/app"], imageId: "sha256:a", state: "exited", labels: {} },
	]);
	const query = new URLSearchParams(f.calls.at(0)?.path.split("?").at(1));
	expect(query.get("all")).toBe("true");
	expect(JSON.parse(query.get("filters") ?? "null")).toEqual({ label: ["owner=a&b"] });
	await f.client.listContainers();
	expect(f.calls.at(-1)?.path).toBe("/containers/json?all=false");
});

test("inspects container state and network addresses without interpreting labels", async () => {
	const f = fixture(200, {
		Id: "c",
		Image: "sha256:a",
		State: { Running: false },
		Config: { Labels: { owner: "x" }, Env: ["SECRET=value"] },
		NetworkSettings: { Networks: { custom: { IPAddress: "10.0.0.2", Aliases: null } } },
	});
	expect(await f.client.inspectContainer("c/a")).toEqual({
		id: "c",
		imageId: "sha256:a",
		running: false,
		labels: { owner: "x" },
		networks: { custom: { address: "10.0.0.2", aliases: [] } },
	});
	expect(f.calls.at(0)?.path).toBe("/containers/c%2Fa/json");
});

test("creates containers with explicit configuration and no platform policy", async () => {
	const f = fixture(201, { Id: "c" });
	expect(
		await f.client.createContainer({
			name: "my/app",
			image: "sha256:a",
			command: ["node", "app.js"],
			env: { TOKEN: "a=b" },
			labels: { owner: "x" },
			network: "custom",
			aliases: ["app"],
			restartPolicy: "unless-stopped",
		}),
	).toBe("c");
	expect(f.calls.at(0)).toEqual({
		method: "POST",
		path: "/containers/create?name=my%2Fapp",
		body: {
			Image: "sha256:a",
			Cmd: ["node", "app.js"],
			Env: ["TOKEN=a=b"],
			Labels: { owner: "x" },
			HostConfig: { NetworkMode: "custom", RestartPolicy: { Name: "unless-stopped" } },
			NetworkingConfig: { EndpointsConfig: { custom: { Aliases: ["app"] } } },
		},
	});
	await f.client.createContainer({ name: "minimal", image: "app" });
	expect(JSON.parse(JSON.stringify(f.calls.at(-1)?.body))).toEqual({ Image: "app", HostConfig: {} });
});

test("starts, stops and removes containers without deleting volumes or forcing removal", async () => {
	const f = fixture(204);
	await f.client.startContainer("c/a");
	await f.client.stopContainer("c/a", 30);
	await f.client.removeContainer("c/a");
	expect(f.calls).toEqual([
		{ method: "POST", path: "/containers/c%2Fa/start", body: undefined },
		{ method: "POST", path: "/containers/c%2Fa/stop?t=30", body: undefined },
		{ method: "DELETE", path: "/containers/c%2Fa", body: undefined },
	]);
	await fixture(304).client.startContainer("c");
	await fixture(304).client.stopContainer("c", 0);
});

test("image inspection and pulling are independent operations", async () => {
	const f = fixture(200, { Id: "sha256:a" });
	expect(await f.client.inspectImage("registry/app:local")).toEqual({ id: "sha256:a" });
	expect(f.calls.at(0)?.path).toBe("/images/registry%2Fapp%3Alocal/json");
	const pull = fixture(200, undefined, '{"status":"pulling"}\n{"status":"done"}\n');
	await pull.client.pullImage("registry/app:local");
	expect(pull.calls).toEqual([
		{ method: "POST", path: "/images/create?fromImage=registry%2Fapp%3Alocal", body: undefined },
	]);
});

test("inspection returns null for missing objects; mutations expose absence and conflicts", async () => {
	const f = fixture(404, { message: "secret" });
	expect(await f.client.inspectContainer("c")).toBeNull();
	expect(await f.client.inspectNetwork("n")).toBeNull();
	expect(await f.client.inspectImage("app")).toBeNull();
	await expect(f.client.removeContainer("c")).rejects.toMatchObject({ kind: "not-found" });
	await expect(fixture(409).client.removeNetwork("n")).rejects.toMatchObject({ kind: "conflict" });
});

test("sanitizes transport errors and unsuccessful responses", async () => {
	const client = new DockerClient({
		async request() {
			throw new Error("SECRET");
		},
	});
	await expect(client.listContainers()).rejects.toEqual(new DockerClientError("unavailable"));
	await expect(fixture(500, { message: "SECRET" }).client.listContainers()).rejects.toEqual(
		new DockerClientError("unavailable"),
	);
	await expect(fixture(201, []).client.listContainers()).rejects.toEqual(new DockerClientError("unavailable"));
});

test.each(["not json", "{}", '[{"Id":"c"}]'])("rejects invalid container lists: %s", async (raw) => {
	await expect(fixture(200, undefined, raw).client.listContainers()).rejects.toEqual(
		new DockerClientError("invalid-response"),
	);
});

test("validates every returned resource and creation identity", async () => {
	const f = fixture(200, {});
	await expect(f.client.inspectContainer("c")).rejects.toMatchObject({ kind: "invalid-response" });
	await expect(f.client.inspectNetwork("n")).rejects.toMatchObject({ kind: "invalid-response" });
	await expect(f.client.inspectImage("app")).rejects.toMatchObject({ kind: "invalid-response" });
	await expect(fixture(201, { Id: "" }).client.createNetwork({ name: "n", driver: "bridge" })).rejects.toMatchObject({
		kind: "invalid-response",
	});
	await expect(fixture(201, {}).client.createContainer({ name: "c", image: "app" })).rejects.toMatchObject({
		kind: "invalid-response",
	});
});

test.each(['{"error":"SECRET"}\n', '{"errorDetail":{"message":"SECRET"}}\n', "broken\n", "null\n"])(
	"detects failures inside successful image pull responses: %s",
	async (raw) => {
		await expect(fixture(200, undefined, raw).client.pullImage("app")).rejects.toBeInstanceOf(DockerClientError);
	},
);
