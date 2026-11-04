import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import type { AgentView } from "@homelab-paas/forge-contracts/agents";
import type { Ticket, MoveTicket, TicketWorkflow } from "@homelab-paas/forge-contracts/tickets";

import type { IAgentExecutionPool } from "../agents/agent-execution-pool.ts";
import { AgentError } from "../agents/errors.ts";
import type { Actor } from "../auth/types.ts";
import { TicketError } from "./errors.ts";
import type { ITicketPrompts } from "./ticket-prompts.ts";
import type { ITicketStore } from "./ticket-store.ts";
import type { ITicketWorkflowStore } from "./ticket-workflow-store.ts";

export interface ITicketAgents {
	createTicketThread(actor: Actor, projectId: string, title: string, workspaceId?: string): Promise<AgentView>;
	dispatch(actor: Actor, id: string, text: string): Promise<AgentView>;
	get(actor: Actor, id: string): Promise<AgentView>;
	resume(actor: Actor, id: string): Promise<AgentView>;
}
export interface ITicketMergeClient {
	/** Advances main only when the verified branch is a clean fast-forward; concurrent ref changes conflict. */
	merge(actor: Actor, workspaceId: string): Promise<"merged" | "rebase">;
	base(actor: Actor, workspaceId: string): Promise<string>;
}
export interface ITicketWorkflowService {
	move(actor: Actor, ticket: Ticket, input: MoveTicket): Promise<void>;
	get(id: string): Promise<TicketWorkflow>;
	message(actor: Actor, ticket: Ticket, text: string): Promise<TicketWorkflow>;
	tick(actor: Actor): Promise<void>;
	recover(actor: Actor): Promise<void>;
}

export class TicketWorkflowService implements ITicketWorkflowService {
	private tail: Promise<unknown> = Promise.resolve();
	private readonly log = createLogger(TicketWorkflowService.name);
	constructor(
		private readonly store: ITicketWorkflowStore,
		private readonly tickets: ITicketStore,
		private readonly agents: ITicketAgents,
		private readonly pool: IAgentExecutionPool,
		private readonly merges: ITicketMergeClient,
		private readonly prompts: ITicketPrompts,
	) {}
	async move(_actor: Actor, ticket: Ticket, input: MoveTicket): Promise<void> {
		return this.serialize(async () => {
			const current = await this.tickets.get(ticket.id);
			if (!current || current.status !== ticket.status) throw new TicketError("ticket-conflict");
			const job = await this.get(ticket.id);
			if (input.status === ticket.status) {
				await this.store.save(job, input);
				return;
			}
			if (ticket.status === "backlog" && input.status === "todo") {
				await this.store.save({ ...job, phase: "planning", state: "queued", plan: undefined }, input);
				return;
			}
			if (job.state !== "idle") throw new TicketError("ticket-conflict");
			if (ticket.status === "todo" && input.status === "in-progress" && job.plan) {
				await this.store.save(
					{
						...job,
						phase: "implementation",
						state: "queued",
						approvedRevision: job.plan.revision,
						message: undefined,
					},
					input,
				);
				return;
			}
			if (ticket.status === "in-review" && input.status === "merging" && job.implementerId) {
				await this.store.save(
					{ ...job, state: "queued", phase: "rebase", mergeAttempts: 0, message: undefined },
					input,
				);
				return;
			}
			throw new TicketError("ticket-conflict");
		});
	}
	async get(id: string): Promise<TicketWorkflow> {
		return (await this.store.get(id)) ?? { ticketId: id, phase: "planning", state: "idle", mergeAttempts: 0 };
	}
	async message(_actor: Actor, ticket: Ticket, text: string): Promise<TicketWorkflow> {
		return this.serialize(async () => {
			const current = await this.tickets.get(ticket.id);
			const job = await this.get(ticket.id);
			if (
				!current
				|| !["todo", "in-review", "in-progress", "merging"].includes(current.status)
				|| !["idle", "failed"].includes(job.state)
				|| !text.trim()
				|| text.length > 8000
			)
				throw new TicketError("ticket-conflict");
			const next: TicketWorkflow = {
				...job,
				state: "queued",
				message: text.trim(),
				phase: current.status === "todo" ? "planning" : current.status === "merging" ? "rebase" : "review",
			};
			await this.store.save(next);
			return next;
		});
	}
	async tick(actor: Actor): Promise<void> {
		return this.serialize(async () => {
			for (const job of await this.store.list()) {
				const ticket = await this.tickets.get(job.ticketId);
				if (!ticket || ["backlog", "done"].includes(ticket.status)) continue;
				try {
					if (job.state === "running") await this.observe(actor, ticket, job);
					else if (job.state === "queued") {
						if (ticket.status === "merging" && !job.message) await this.merge(actor, job);
						else if (this.pool.available()) await this.dispatch(actor, ticket, job);
					}
				} catch (err) {
					this.log.error({ err, ticketId: ticket.id }, "Ticket execution needs attention");
					if (err instanceof AgentError && err.code === "agent-capacity") {
						await this.store.save({ ...job, state: "queued" });
					} else
						await this.store.save({ ...job, state: job.state === "dispatching" ? "uncertain" : "failed" });
				}
			}
		});
	}
	async recover(actor: Actor): Promise<void> {
		return this.serialize(async () => {
			for (const job of await this.store.list()) {
				if (!["running", "dispatching", "uncertain"].includes(job.state)) continue;
				const ticket = await this.tickets.get(job.ticketId);
				if (!ticket) continue;
				const id = job.phase === "planning" ? job.plannerId : job.implementerId;
				await this.store.save({ ...job, state: "uncertain" });
				if (!id) continue;
				try {
					const view = await this.agents.resume(actor, id);
					if (view.thread.status === "idle" || view.thread.status === "uncertain") continue;
					await this.observe(actor, ticket, job);
				} catch (err) {
					this.log.error({ err, ticketId: ticket.id }, "Could not reconcile ticket execution");
				}
			}
		});
	}
	private async dispatch(actor: Actor, ticket: Ticket, job: TicketWorkflow): Promise<void> {
		job.state = "dispatching";
		await this.store.save(job);
		if (!job.plannerId) {
			const view = await this.agents.createTicketThread(actor, ticket.projectId, `${ticket.id} planning`);
			job.plannerId = view.thread.id;
			job.workspaceId = view.thread.workspaceId;
			job.baseSha = await this.merges.base(actor, job.workspaceId);
			await this.store.save(job);
		}
		if (job.phase !== "planning" && !job.implementerId) {
			const view = await this.agents.createTicketThread(
				actor,
				ticket.projectId,
				`${ticket.id} implementation`,
				job.workspaceId,
			);
			job.implementerId = view.thread.id;
			await this.store.save(job);
		}
		const id = job.phase === "planning" ? job.plannerId : job.implementerId!;
		await this.agents.dispatch(actor, id, this.prompts.build(ticket, job));
		job.state = "running";
		await this.store.save(job);
	}
	private async observe(actor: Actor, ticket: Ticket, job: TicketWorkflow): Promise<void> {
		const id = job.phase === "planning" ? job.plannerId : job.implementerId;
		if (!id) return;
		const view = await this.agents.get(actor, id);
		if (["running", "waiting", "creating"].includes(view.thread.status)) {
			await this.store.save({ ...job, state: "running" });
			return;
		}
		if (view.thread.status !== "completed") {
			await this.store.save({ ...job, state: view.thread.status === "uncertain" ? "uncertain" : "failed" });
			return;
		}
		job.state = "idle";
		job.message = undefined;
		if (job.phase === "planning") {
			const answer = view.items.findLast((item) => item.role === "assistant")?.text.trim();
			if (!answer || view.truncated) {
				await this.store.save({ ...job, state: "failed" });
				return;
			}
			job.plan = { revision: (job.plan?.revision ?? 0) + 1, text: answer };
			await this.store.save(job);
		} else if (ticket.status === "merging") await this.merge(actor, job);
		else await this.store.save(job, ticket.status === "in-progress" ? { status: "in-review" } : undefined);
	}
	private async merge(actor: Actor, job: TicketWorkflow): Promise<void> {
		if (!job.workspaceId) throw new TicketError("ticket-conflict");
		if ((await this.merges.merge(actor, job.workspaceId)) === "merged") {
			await this.store.save({ ...job, state: "idle", message: undefined }, { status: "done" });
		} else {
			job.mergeAttempts += 1;
			await this.store.save({
				...job,
				phase: "rebase",
				state: job.mergeAttempts >= 3 ? "failed" : "queued",
				message: "Rebase onto latest main and validate.",
			});
		}
	}
	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => {});
		return result;
	}
}
