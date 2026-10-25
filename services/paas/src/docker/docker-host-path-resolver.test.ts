import { expect, test, vi } from "vitest";

import { DockerHostPathResolver } from "./docker-host-path-resolver.ts";
import type { DockerContainer, DockerContainerDetails } from "./types.ts";

const fixture = () => {
	const labels = { "homelab-paas.cluster": "prod", "homelab-paas.role": "control-plane" };
	const listContainers = vi.fn(async (): Promise<DockerContainer[]> => [
		{ id: "controller", names: [], imageId: "image", state: "running", labels },
	]);
	const inspectContainer = vi.fn(async (): Promise<DockerContainerDetails | null> => ({
		id: "controller",
		imageId: "image",
		running: true,
		labels,
		networks: {},
		mounts: [{ type: "bind", source: "/srv/config", destination: "/etc/homelab-paas" }],
	}));
	return {
		listContainers,
		inspectContainer,
		resolver: new DockerHostPathResolver({ listContainers, inspectContainer }, "prod"),
		labels,
	};
};

test("resolves the actual host path using this cluster's running control-plane bind mounts", async () => {
	const f = fixture();
	expect(await f.resolver.resolve("/etc/homelab-paas/env/demo.env")).toBe("/srv/config/env/demo.env");
	expect(f.listContainers).toHaveBeenCalledWith({ all: false, labels: f.labels });
	expect(f.inspectContainer).toHaveBeenCalledWith("controller");
});

test("prefers the most specific mount and does not mistake a named volume or prefix for a bind", async () => {
	const f = fixture();
	const controller = await f.inspectContainer();
	controller!.mounts!.push({
		type: "bind",
		source: "/secrets/demo.env",
		destination: "/etc/homelab-paas/env/demo.env",
	});
	f.inspectContainer.mockResolvedValue(controller);
	expect(await f.resolver.resolve("/etc/homelab-paas/env/demo.env")).toBe("/secrets/demo.env");
	controller!.mounts!.push({
		type: "volume",
		source: "/docker/volumes/private",
		destination: "/etc/homelab-paas/env/other.env",
	});
	expect(await f.resolver.resolve("/etc/homelab-paas/env/other.env")).toBeUndefined();
	expect(await f.resolver.resolve("/etc/homelab-paas-elsewhere/demo.env")).toBeUndefined();
});

test("does not guess when controllers are absent, ambiguous, foreign, or disappear", async () => {
	const f = fixture();
	const peers = await f.listContainers();
	for (const containers of [[], [...peers, ...peers], peers.map((peer) => ({ ...peer, labels: {} }))]) {
		f.listContainers.mockResolvedValue(containers);
		expect(await f.resolver.resolve("/etc/homelab-paas/env/demo.env")).toBeUndefined();
	}
	f.listContainers.mockResolvedValue(peers);
	f.inspectContainer.mockResolvedValue(null);
	expect(await f.resolver.resolve("/etc/homelab-paas/env/demo.env")).toBeUndefined();
});

test("rejects unsafe paths and preserves Docker failures", async () => {
	const f = fixture();
	await expect(f.resolver.resolve("/etc/../private")).rejects.toThrow("Invalid container path");
	expect(f.listContainers).not.toHaveBeenCalled();
	const cause = new Error("Docker unavailable");
	f.listContainers.mockRejectedValue(cause);
	await expect(f.resolver.resolve("/etc/homelab-paas/env/demo.env")).rejects.toMatchObject({ cause });
});
