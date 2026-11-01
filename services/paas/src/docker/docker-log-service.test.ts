import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { DockerLogService } from "./docker-log-service.ts";

test("ingress logs follow only the discovered Envoy, redact secrets and honor cancellation", async () => {
	const controller = new AbortController();
	const follow = vi.fn(async (id: string, receive: (text: string) => void, signal: AbortSignal) => {
		expect(id).toBe("envoy");
		expect(signal).toBe(controller.signal);
		receive('2026-11-01T07:23:50Z {"status":200}\nAuthorization: Bearer abc\nready\n');
		controller.abort();
		receive("stale\n");
	});
	const inspector = {
		inspectServiceContainer: async () => null,
		inspectControlPlaneContainer: vi.fn(),
		inspectEnvoyContainer: vi.fn(async () => ({
			id: "envoy",
			imageId: "image",
			running: true,
			labels: {},
			networks: {},
			env: { ENVOY_UID: "0" },
		})),
	};
	const service = new DockerLogService(inspector, { follow }, testConfig());
	const receive = vi.fn();
	await service.followIngress(receive, controller.signal);
	expect(receive).toHaveBeenCalledWith("envoy", expect.stringContaining("ready"));
	expect(JSON.stringify(receive.mock.calls)).not.toMatch(/Bearer abc|stale/);
	expect(receive).toHaveBeenCalledWith("envoy", expect.stringContaining('2026-11-01T07:23:50Z {"status":200}'));
	expect(inspector.inspectControlPlaneContainer).not.toHaveBeenCalled();
	inspector.inspectEnvoyContainer.mockRejectedValueOnce(new Error("unavailable"));
	await expect(service.followIngress(receive, new AbortController().signal)).rejects.toThrow("unavailable");
	expect(follow).toHaveBeenCalledTimes(1);
});

test("control-plane logs mask credential fields and preserve ordinary text before emitting bounded tails", async () => {
	const config = testConfig();
	const inspected = {
		id: "controller",
		imageId: "image",
		running: true,
		labels: {},
		networks: {},
		env: { PASSWORD: "control-secret" },
	};
	const signal = new AbortController().signal;
	const follow = vi.fn(async (_id: string, receive: (text: string) => void, passed: AbortSignal) => {
		expect(passed).toBe(signal);
		receive("password=control-sec");
		receive("ret\n");
		receive("to");
		receive("ken\n");
		for (let index = 0; index < 210; index++) receive(`line ${index}\n`);
	});
	const service = new DockerLogService(
		{
			inspectServiceContainer: async () => null,
			inspectControlPlaneContainer: async () => inspected,
			inspectEnvoyContainer: vi.fn(),
		},
		{ follow },
		config,
	);
	const receive = vi.fn();
	await service.followControlPlane(receive, signal);
	expect(follow.mock.calls[0]?.[0]).toBe("controller");
	expect(JSON.stringify(receive.mock.calls)).not.toContain("control-sec");
	expect(JSON.stringify(receive.mock.calls)).toContain("token");
	expect(receive.mock.calls.at(-1)?.[0]).toBe("controller");
	expect(receive.mock.calls.at(-1)?.[1].split("\n").filter(Boolean)).toHaveLength(200);
});

test("masks credential fields across chunks without masking arbitrary environment or descriptor values", async () => {
	const inspected = {
		id: "c",
		imageId: "image",
		running: true,
		labels: {},
		networks: {},
		env: { PASSWORD: "private\nvalue" },
	};
	const signal = new AbortController().signal;
	const service = new DockerLogService(
		{
			inspectServiceContainer: async () => inspected,
			inspectControlPlaneContainer: async () => inspected,
			inspectEnvoyContainer: vi.fn(),
		},
		{
			follow: async (_id, receive, passed) => {
				expect(passed).toBe(signal);
				for (const chunk of [
					"password=private",
					"value\nsec",
					"ret\n",
					...Array.from({ length: 210 }, (_, index) => `line${index}\n`),
				])
					receive(chunk);
			},
		},
		testConfig(),
	);
	const snapshots: string[] = [];
	await service.follow("demo", "c", (text) => snapshots.push(text), signal);
	expect(snapshots.join("")).not.toContain("private");
	expect(snapshots.join("")).not.toContain("value");
	expect(snapshots.join("")).toContain("secret");
	expect(snapshots.at(-1)?.split("\n").filter(Boolean)).toHaveLength(200);
	expect(snapshots.at(-1)).toContain("line209");
});

test("ownership failures and absence never open a stream", async () => {
	const follow = vi.fn();
	for (const inspectServiceContainer of [
		async () => null,
		async () => {
			throw new Error("private ownership error");
		},
	]) {
		const service = new DockerLogService(
			{
				inspectServiceContainer,
				inspectEnvoyContainer: vi.fn(),
				inspectControlPlaneContainer: async () => {
					throw new Error("not available");
				},
			},
			{ follow },
			testConfig(),
		);
		await expect(service.follow("demo", "c", () => {}, new AbortController().signal)).rejects.toThrow();
	}
	expect(follow).not.toHaveBeenCalled();
});
