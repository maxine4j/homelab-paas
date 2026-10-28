import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { DockerLogService } from "./docker-log-service.ts";

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
		{ inspectServiceContainer: async () => inspected },
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
		const service = new DockerLogService({ inspectServiceContainer }, { follow }, testConfig());
		await expect(service.follow("demo", "c", [], () => {}, new AbortController().signal)).rejects.toThrow();
	}
	expect(follow).not.toHaveBeenCalled();
});
