import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { DockerLogService } from "./docker-log-service.ts";

test("control-plane logs redact actual environment and platform secrets before emitting bounded tails", async () => {
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
		receive("control-sec");
		receive("ret\n");
		receive("to");
		receive("ken\n");
		for (let index = 0; index < 210; index++) receive(`line ${index}\n`);
	});
	const service = new DockerLogService(
		{ inspectServiceContainer: async () => null, inspectControlPlaneContainer: async () => inspected },
		{ follow },
		config,
	);
	const receive = vi.fn();
	await service.followControlPlane(receive, signal);
	expect(follow.mock.calls[0]?.[0]).toBe("controller");
	expect(JSON.stringify(receive.mock.calls)).not.toContain("control-sec");
	expect(JSON.stringify(receive.mock.calls)).not.toContain("token");
	expect(receive.mock.calls.at(-1)?.[0]).toBe("controller");
	expect(receive.mock.calls.at(-1)?.[1].split("\n").filter(Boolean)).toHaveLength(200);
});

test("redacts actual env and descriptor secrets across chunks before bounded snapshots leave Docker", async () => {
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
		{ inspectServiceContainer: async () => inspected, inspectControlPlaneContainer: async () => inspected },
		{
			follow: async (_id, receive, passed) => {
				expect(passed).toBe(signal);
				for (const chunk of [
					"hello private\n",
					"value sec",
					"ret\n",
					...Array.from({ length: 210 }, (_, index) => `line${index}\n`),
				])
					receive(chunk);
			},
		},
		testConfig(),
	);
	const snapshots: string[] = [];
	await service.follow("demo", "c", ["secret"], (text) => snapshots.push(text), signal);
	expect(snapshots.join("")).not.toContain("private");
	expect(snapshots.join("")).not.toContain("value");
	expect(snapshots.join("")).not.toContain("sec");
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
				inspectControlPlaneContainer: async () => {
					throw new Error("not available");
				},
			},
			{ follow },
			testConfig(),
		);
		await expect(service.follow("demo", "c", [], () => {}, new AbortController().signal)).rejects.toThrow();
	}
	expect(follow).not.toHaveBeenCalled();
});
