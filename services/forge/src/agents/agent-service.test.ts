import { expect, test, vi } from "vitest";

import { AccessService } from "../auth/access-service.ts";
import type { AgentRuntimeView } from "../codex/types.ts";
import type { IProjectService } from "../projects/project-service.ts";
import { AgentService, type IAgentWorkspaces } from "./agent-service.ts";
import type { AgentThreadRecord } from "./types.ts";

const owner = { username: "owner" };
const projectId = "123e4567-e89b-42d3-a456-426614174000";
const setup = () => {
	let sequence = 0;
	const records = new Map<string, AgentThreadRecord>();
	const views = new Map<string, AgentRuntimeView>();
	let changed: (id: string) => void = () => {};
	const id = () => `123e4567-e89b-42d3-a456-${String(++sequence).padStart(12, "0")}`;
	const createdAt = "2026-11-03T00:00:00.000Z";
	const projects: IProjectService = {
		get: vi.fn<IProjectService["get"]>(async () => ({
			id: projectId,
			name: "Project",
			status: "ready",
			createdAt,
		})),
		create: vi.fn(),
		list: vi.fn(),
		retry: vi.fn(),
		recover: vi.fn(),
	};
	const workspaces: IAgentWorkspaces = {
		create: vi.fn<IAgentWorkspaces["create"]>(async () => ({
			id: id(),
			projectId,
			name: "Chat",
			status: "ready",
			branch: "forge/workspace/test",
			createdAt,
		})),
		resolve: vi.fn<IAgentWorkspaces["resolve"]>(async (_actor, workspaceId) => ({
			path: `/data/worktrees/${workspaceId}`,
			workspace: {
				id: workspaceId,
				projectId,
				name: "Chat",
				status: "ready",
				branch: "forge/workspace/test",
				createdAt,
			},
		})),
	};
	const client = {
		start: vi.fn(async () => {
			const key = `codex-${views.size + 1}`;
			views.set(key, { status: "idle", items: [], requests: [], truncated: false });
			return key;
		}),
		read: (key: string) => structuredClone(views.get(key)!),
		resume: vi.fn(async (key: string) => {
			const view = views.get(key)!;
			view.status = "completed";
			return view;
		}),
		send: vi.fn(async (key: string) => {
			const view = views.get(key)!;
			view.status = "running";
			view.turnId = "turn";
		}),
		interrupt: vi.fn(async () => {}),
		reply: vi.fn(),
		subscribe: (listener: (key: string) => void) => {
			changed = listener;
			return () => {};
		},
	};
	const store = {
		insert: async (record: AgentThreadRecord) => {
			records.set(record.id, structuredClone(record));
		},
		update: async (record: AgentThreadRecord) => {
			records.set(record.id, structuredClone(record));
		},
		get: async (key: string) => structuredClone(records.get(key)),
		list: async () => [...records.values()],
		recover: async () => {},
	};
	const service = new AgentService(
		store,
		client,
		workspaces,
		projects,
		new AccessService({ owner: "owner", origin: "https://forge.example" }),
		id,
		() => new Date(createdAt),
	);
	return { service, client, workspaces, records, views, changed: (key: string) => changed(key) };
};
test("threads have independent verified worktrees and may execute concurrently; same-thread duplicate sends conflict", async () => {
	const { service, client, workspaces } = setup();
	const first = await service.create(owner, projectId, "First");
	const second = await service.create(owner, projectId, "Second");
	expect(first.thread.workspaceId).not.toBe(second.thread.workspaceId);
	await Promise.all([service.send(owner, first.thread.id, "One"), service.send(owner, second.thread.id, "Two")]);
	expect(client.send).toHaveBeenCalledTimes(2);
	expect(workspaces.resolve).toHaveBeenCalledWith(owner, first.thread.workspaceId);
	await expect(service.send(owner, first.thread.id, "Duplicate")).rejects.toThrow("agent-conflict");
	expect(JSON.stringify(await service.list(owner, projectId))).not.toContain("codex-");
	await service.shutdown();
});
test("empty chats survive restart without depending on an unpersisted Codex thread", async () => {
	const { service, client, records } = setup();
	const { thread } = await service.create(owner, projectId, "Empty");
	expect(client.start).not.toHaveBeenCalled();
	expect(records.get(thread.id)).toMatchObject({ status: "idle" });
	expect(records.get(thread.id)?.codexId).toBeUndefined();
	expect((await service.resume(owner, thread.id)).thread.status).toBe("idle");
	expect(client.resume).not.toHaveBeenCalled();
	await service.shutdown();
});
test("shutdown drains an accepted chat creation before storage may close", async () => {
	const { service, workspaces } = setup();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const create = vi.mocked(workspaces.create).getMockImplementation()!;
	vi.mocked(workspaces.create).mockImplementation(async (...args) => {
		await gate;
		return create(...args);
	});
	const creation = service.create(owner, projectId, "Pending");
	let stopped = false;
	const shutdown = service.shutdown().then(() => {
		stopped = true;
	});
	try {
		await Promise.resolve();
		await Promise.resolve();
		expect(stopped).toBe(false);
	} finally {
		release();
		await creation;
		await shutdown;
	}
});
test("connection loss requires explicit reconciliation; uncertain turns are never sent again", async () => {
	const { service, client, records, views, changed } = setup();
	const { thread } = await service.create(owner, projectId, "Chat");
	await service.send(owner, thread.id, "Work");
	const codexId = records.get(thread.id)!.codexId!;
	views.get(codexId)!.status = "uncertain";
	changed(codexId);
	expect((await service.get(owner, thread.id)).thread.status).toBe("uncertain");
	await expect(service.send(owner, thread.id, "Retry")).rejects.toThrow("agent-conflict");
	await service.resume(owner, thread.id);
	expect(client.resume).toHaveBeenCalledOnce();
	expect(client.send).toHaveBeenCalledOnce();
	await service.send(owner, thread.id, "Continue");
	expect(client.send).toHaveBeenCalledTimes(2);
	await service.shutdown();
});
test("authorization precedes storage/workspace/runtime access; failed worktree verification prevents execution", async () => {
	const { service, workspaces, client } = setup();
	await expect(service.create({ username: "outsider" }, projectId, "Chat")).rejects.toThrow("Access denied");
	expect(workspaces.create).not.toHaveBeenCalled();
	const { thread } = await service.create(owner, projectId, "Chat");
	vi.mocked(workspaces.resolve).mockRejectedValue(new Error("Invalid worktree"));
	await expect(service.send(owner, thread.id, "Work")).rejects.toThrow();
	expect(client.send).not.toHaveBeenCalled();
	for (const operation of [
		() => service.get({ username: "outsider" }, thread.id),
		() => service.reply({ username: "outsider" }, thread.id, { requestId: "x", decision: "accept" }),
		() => service.interrupt({ username: "outsider" }, thread.id),
	])
		await expect(operation()).rejects.toThrow("Access denied");
	await service.shutdown();
});
