import { expect, test, vi } from "vitest";

import type { DockerContainerDetails, ServiceContainer } from "../docker/types.ts";
import { RuntimeObservations } from "./runtime-observations.ts";

const fixture = () => {
	const container: ServiceContainer = {
		id: "c",
		resourceId: "app",
		revision: "r",
		spec: "s",
		imageId: "i",
		state: "running",
	};
	const details: DockerContainerDetails = {
		id: "c",
		imageId: "i",
		labels: {},
		env: { SECRET: "value" },
		running: true,
		networks: {},
	};
	const docker = {
		listServiceContainers: vi.fn(async () => [container]),
		inspectServiceContainer: vi.fn(async () => details),
		inspectServiceNetwork: vi.fn(async () => null),
		readServiceContainerLogs: vi.fn(async () => "logs"),
	};
	let now = 0;
	return {
		docker,
		container,
		details,
		advance: () => {
			now += 30_000;
		},
		observations: new RuntimeObservations(docker, () => now),
	};
};

test("health/list/detail share one Docker observation per service generation; fresh scopes re-read mutable state", async () => {
	const f = fixture();
	for (let pass = 0; pass < 3; pass++) {
		f.observations.invalidate("demo");
		await Promise.all([
			f.observations.listServiceContainers("demo"),
			f.observations.listServiceContainers("demo", "app"),
		]);
		await Promise.all([
			f.observations.inspectServiceContainer("demo", "c"),
			f.observations.inspectServiceContainer("demo", "c"),
		]);
		await Promise.all([f.observations.inspectServiceNetwork("demo"), f.observations.inspectServiceNetwork("demo")]);
	}
	expect(f.docker.listServiceContainers).toHaveBeenCalledTimes(3);
	expect(f.docker.inspectServiceContainer).toHaveBeenCalledTimes(3);
	expect(f.docker.inspectServiceNetwork).toHaveBeenCalledTimes(3);
	const copy = await f.observations.inspectServiceContainer("demo", "c");
	copy!.running = false;
	expect((await f.observations.inspectServiceContainer("demo", "c"))?.running).toBe(true);
	f.details.running = false;
	f.advance();
	expect((await f.observations.inspectServiceContainer("demo", "c"))?.running).toBe(false);
});

test("invalidation during a read rejects stale completion and failed reads never restore cached healthy state", async () => {
	const f = fixture();
	let release!: (containers: ServiceContainer[]) => void;
	f.docker.listServiceContainers.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const stale = f.observations.listServiceContainers("demo");
	f.observations.invalidate("demo");
	f.docker.listServiceContainers.mockResolvedValue([]);
	release([f.container]);
	expect(await stale).toEqual([]);
	f.observations.invalidate("demo");
	f.docker.listServiceContainers.mockRejectedValueOnce(new Error("Docker unavailable"));
	await expect(f.observations.listServiceContainers("demo")).rejects.toThrow("Docker unavailable");
	await expect(f.observations.listServiceContainers("demo")).rejects.toThrow("Docker unavailable");
	f.observations.invalidate("demo");
	expect(await f.observations.listServiceContainers("demo")).toEqual([]);
});

test("a slow fresh read crossing the TTL resolves once instead of restarting forever", async () => {
	const f = fixture();
	f.docker.listServiceContainers.mockImplementationOnce(async () => {
		f.advance();
		return [f.container];
	});
	expect(await f.observations.listServiceContainers("demo")).toEqual([f.container]);
	expect(f.docker.listServiceContainers).toHaveBeenCalledTimes(1);
});

test("fresh generations reuse immutable metadata but independently refresh runtime and network attachments", async () => {
	const f = fixture();
	await f.observations.inspectServiceContainer("demo", "c");
	f.details.running = false;
	f.details.networks = { changed: { address: "10.0.0.3", aliases: ["app"] } };
	// An adapter may return a new object, but immutable configuration belongs to the container identity.
	f.details.env = { SECRET: "unexpected replacement" };
	f.observations.invalidate("demo");
	expect(await f.observations.inspectServiceContainer("demo", "c")).toMatchObject({
		running: false,
		networks: f.details.networks,
		env: { SECRET: "value" },
	});
});
