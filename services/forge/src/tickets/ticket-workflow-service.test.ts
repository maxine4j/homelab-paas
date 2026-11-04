import type { AgentView } from "@homelab-paas/forge-contracts/agents";
import type { Ticket, TicketWorkflow } from "@homelab-paas/forge-contracts/tickets";
import { expect, test, vi } from "vitest";

import { AgentExecutionPool } from "../agents/agent-execution-pool.ts";
import { TicketPrompts } from "./ticket-prompts.ts";
import { TicketWorkflowService, type ITicketAgents } from "./ticket-workflow-service.ts";

const actor = { username: "owner" };
const projectId = "123e4567-e89b-42d3-a456-426614174000";
const fixture = () => {
	const jobs = new Map<string, TicketWorkflow>();
	const tickets = new Map<string, Ticket>();
	const views = new Map<string, AgentView>();
	const pool = new AgentExecutionPool();
	const agents = {
		createTicketThread: vi.fn<ITicketAgents["createTicketThread"]>(
			async (_actor, projectId, title, workspaceId) => {
				const id = `thread-${views.size}`;
				const view: AgentView = {
					thread: {
						id,
						projectId,
						title,
						workspaceId: workspaceId ?? `workspace-${views.size}`,
						createdAt: "2026-11-03T00:00:00.000Z",
						status: "idle",
					},
					items: [],
					requests: [],
					truncated: false,
				};
				views.set(id, view);
				return structuredClone(view);
			},
		),
		dispatch: vi.fn<ITicketAgents["dispatch"]>(async (_actor, id) => {
			pool.claim(id);
			const view = views.get(id)!;
			view.thread.status = "running";
			return structuredClone(view);
		}),
		get: vi.fn<ITicketAgents["get"]>(async (_actor, id) => structuredClone(views.get(id)!)),
		resume: vi.fn<ITicketAgents["resume"]>(async (_actor, id) => structuredClone(views.get(id)!)),
	};
	const store = {
		get: async (id: string) => structuredClone(jobs.get(id)),
		list: async () => [...jobs.values()].map((job) => structuredClone(job)),
		save: vi.fn(async (job: TicketWorkflow, move?: { status: Ticket["status"] }) => {
			jobs.set(job.ticketId, structuredClone(job));
			if (move) tickets.get(job.ticketId)!.status = move.status;
		}),
	};
	const ticketStore = {
		get: async (id: string) => structuredClone(tickets.get(id)),
		list: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		move: vi.fn(),
	};
	const merges = {
		merge: vi.fn(async (): Promise<"merged" | "rebase"> => "merged"),
		base: vi.fn(async () => "a".repeat(40)),
	};
	const service = new TicketWorkflowService(store, ticketStore, agents, pool, merges, new TicketPrompts());
	const create = (id = "FORGE-1") => {
		const ticket: Ticket = {
			id,
			projectId,
			title: "Add search",
			description: "Find files",
			status: "backlog",
			createdAt: "2026-11-03T00:00:00.000Z",
		};
		tickets.set(id, ticket);
		return ticket;
	};
	const complete = (id: string, text = "Plan: add search with tests") => {
		const view = views.get(id)!;
		view.thread.status = "completed";
		view.items.push({ id: `answer-${view.items.length}`, role: "assistant", text });
		pool.observe(id, "completed");
	};
	return { service, jobs, tickets, views, pool, agents, merges, create, complete };
};

test("planning starts only with capacity, saves revisions, and approval starts fresh context in the same worktree", async () => {
	const f = fixture();
	const ticket = f.create();
	await f.service.move(actor, ticket, { status: "todo" });
	expect(ticket.status).toBe("todo");
	for (const id of ["one", "two", "three"]) f.pool.claim(id);
	await f.service.tick(actor);
	expect(f.agents.createTicketThread).not.toHaveBeenCalled();
	f.pool.observe("one", "completed");
	await f.service.tick(actor);
	const planning = f.jobs.get(ticket.id)!;
	expect(planning).toMatchObject({ phase: "planning", state: "running", baseSha: "a".repeat(40) });
	await expect(f.service.move(actor, ticket, { status: "in-progress" })).rejects.toThrow("ticket-conflict");
	f.complete(planning.plannerId!);
	await f.service.tick(actor);
	expect(f.jobs.get(ticket.id)?.plan).toEqual({ revision: 1, text: "Plan: add search with tests" });
	await f.service.message(actor, ticket, "Include filtering");
	await expect(f.service.move(actor, ticket, { status: "in-progress" })).rejects.toThrow("ticket-conflict");
	await f.service.tick(actor);
	f.complete(planning.plannerId!, "Updated plan with filtering");
	await f.service.tick(actor);
	expect(f.jobs.get(ticket.id)?.plan?.revision).toBe(2);
	await f.service.move(actor, ticket, { status: "in-progress" });
	await f.service.tick(actor);
	const implementation = f.jobs.get(ticket.id)!;
	expect(implementation).toMatchObject({
		approvedRevision: 2,
		phase: "implementation",
		state: "running",
		workspaceId: planning.workspaceId,
	});
	expect(implementation.implementerId).not.toBe(planning.plannerId);
	expect(f.agents.dispatch.mock.calls.at(-1)?.[2]).toContain("Updated plan with filtering");
	expect(f.agents.dispatch.mock.calls.at(-1)?.[2]).toContain("Red → Green → Refactor");
});

test("implementation and review complete, divergent merge rebases through the pool then fast-forwards to done", async () => {
	const f = fixture();
	const ticket = f.create();
	await f.service.move(actor, ticket, { status: "todo" });
	await f.service.tick(actor);
	f.complete(f.jobs.get(ticket.id)!.plannerId!);
	await f.service.tick(actor);
	await f.service.move(actor, ticket, { status: "in-progress" });
	await f.service.tick(actor);
	const id = f.jobs.get(ticket.id)!.implementerId!;
	f.complete(id, "Implemented and validated");
	await f.service.tick(actor);
	expect(ticket.status).toBe("in-review");
	await f.service.message(actor, ticket, "Fix empty search");
	await f.service.tick(actor);
	await expect(f.service.move(actor, ticket, { status: "merging" })).rejects.toThrow("ticket-conflict");
	f.complete(id, "Fixed with tests");
	await f.service.tick(actor);
	f.merges.merge.mockResolvedValueOnce("rebase");
	await f.service.move(actor, ticket, { status: "merging" });
	await f.service.tick(actor);
	expect(f.jobs.get(ticket.id)).toMatchObject({ phase: "rebase", state: "queued" });
	await f.service.tick(actor);
	expect(f.agents.dispatch.mock.calls.at(-1)?.[2]).toContain("Rebase the ticket branch");
	f.complete(id, "Rebased and validated");
	await f.service.tick(actor);
	expect(ticket.status).toBe("done");
	expect(f.merges.merge).toHaveBeenCalledTimes(2);
	await expect(f.service.move(actor, ticket, { status: "backlog" })).rejects.toThrow("ticket-conflict");
});

test("queued work survives restart; ambiguous dispatch never replays and failed execution never advances", async () => {
	const f = fixture();
	const ticket = f.create();
	await expect(f.service.move(actor, ticket, { status: "done" })).rejects.toThrow("ticket-conflict");
	await f.service.move(actor, ticket, { status: "todo" });
	await f.service.recover(actor);
	await f.service.tick(actor);
	const job = f.jobs.get(ticket.id)!;
	job.state = "dispatching";
	f.views.get(job.plannerId!)!.thread.status = "idle";
	await f.service.recover(actor);
	await f.service.tick(actor);
	expect(f.jobs.get(ticket.id)?.state).toBe("uncertain");
	expect(f.agents.dispatch).toHaveBeenCalledOnce();
	f.views.get(job.plannerId!)!.thread.status = "failed";
	await f.service.recover(actor);
	expect(f.jobs.get(ticket.id)?.state).toBe("failed");
	expect(ticket.status).toBe("todo");
});
