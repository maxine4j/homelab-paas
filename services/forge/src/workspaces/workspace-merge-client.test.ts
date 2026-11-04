import { expect, test, vi } from "vitest";

import { WorkspaceMergeClient } from "./workspace-merge-client.ts";

test("fast-forward checks ancestry and clean files, then atomically updates main with its expected SHA", async () => {
	const main = "a".repeat(40),
		head = "b".repeat(40);
	const run = vi.fn(async (args: string[]) => {
		if (args.includes("status")) return "";
		if (args.includes("merge-base")) return main;
		if (args.includes("rev-parse")) return args.includes("refs/heads/main") ? main : head;
		return "";
	});
	const workspaces = {
		create: vi.fn(),
		resolve: vi.fn(async () => ({
			path: "/data/worktrees/test",
			workspace: {
				id: "test",
				projectId: "project",
				name: "Task",
				branch: "forge/workspace/test",
				status: "ready" as const,
				createdAt: "2026-11-03T00:00:00.000Z",
				baseSha: main,
			},
		})),
	};
	const client = new WorkspaceMergeClient(workspaces, { run });
	expect(await client.merge({ username: "owner" }, "test")).toBe("merged");
	expect(run).toHaveBeenCalledWith(["-C", "/data/worktrees/test", "update-ref", "refs/heads/main", head, main]);
	run.mockImplementation(async (args) => (args.includes("status") ? " M file.ts" : head));
	await expect(client.merge({ username: "owner" }, "test")).rejects.toThrow("ticket-conflict");
	run.mockImplementation(async (args) => {
		if (args.includes("status")) return "";
		if (args.includes("merge-base")) return "c".repeat(40);
		return args.includes("refs/heads/main") ? main : head;
	});
	expect(await client.merge({ username: "owner" }, "test")).toBe("rebase");
	expect(run.mock.calls.filter(([args]) => args.includes("update-ref"))).toHaveLength(1);
});
