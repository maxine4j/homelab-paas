import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import {
	agentReplySchema,
	type AgentReply,
	type AgentRequest,
	type AgentItem,
} from "@homelab-paas/forge-contracts/agents";
import { z } from "zod";

import type { ICodexAgentConnection } from "../accounts/codex-connection.ts";
import { AgentError } from "../agents/errors.ts";
import type { AgentRuntimeView } from "./types.ts";
export interface ICodexAgentClient {
	/** Uses persistent Codex history. Failures throw AgentError; requests are never replayed. */
	start(path: string): Promise<string>;
	resume(id: string, path: string): Promise<AgentRuntimeView>;
	read(id: string): AgentRuntimeView;
	send(id: string, path: string, text: string): Promise<void>;
	interrupt(id: string, turnId: string): Promise<void>;
	reply(id: string, input: AgentReply): void;
	subscribe(listener: (id: string) => void): () => void;
}
export class CodexAgentClient implements ICodexAgentClient {
	private readonly log = createLogger(CodexAgentClient.name);
	private readonly views = new Map<string, AgentRuntimeView>();
	private readonly pending = new Map<string, { threadId: string; turnId: string; rpcId: string | number }>();
	private readonly listeners = new Set<(id: string) => void>();
	private readonly revisions = new Map<string, number>();
	constructor(
		private readonly connection: ICodexAgentConnection,
		private readonly realpath: (path: string) => Promise<string>,
		private readonly generateId: () => string,
	) {
		connection.subscribe((method, params) => this.notification(method, params));
		connection.subscribeRequests((id, method, params) => this.serverRequest(id, method, params));
	}
	async start(path: string): Promise<string> {
		return this.guard(async () => {
			path = await this.realpath(path);
			await this.connection.initialize();
			const result = threadResponse.parse(await this.connection.request("thread/start", this.options(path)));
			if (result.thread.cwd !== path) throw new Error("Codex workspace identity mismatch");
			this.views.set(result.thread.id, this.hydrate(result.thread));
			return result.thread.id;
		});
	}
	async resume(id: string, path: string): Promise<AgentRuntimeView> {
		return this.guard(async () => {
			const revision = this.revisions.get(id);
			const before = new Map(this.views.get(id)?.items.map((item) => [item.id, item.text]));
			if (!this.views.has(id))
				this.views.set(id, { status: "uncertain", items: [], requests: [], truncated: false });
			path = await this.realpath(path);
			await this.connection.initialize();
			const result = threadResponse.parse(
				await this.connection.request("thread/resume", {
					threadId: id,
					...this.options(path),
					excludeTurns: true,
				}),
			);
			if (result.thread.id !== id || result.thread.cwd !== path)
				throw new Error("Codex workspace identity mismatch");
			const page = z.object({ data: z.array(turnSchema), nextCursor: z.string().nullable() }).parse(
				await this.connection.request("thread/turns/list", {
					threadId: id,
					limit: 20,
					sortDirection: "desc",
					itemsView: "full",
				}),
			);
			result.thread.turns = page.data.reverse();
			const view = this.hydrate(result.thread);
			view.truncated ||= page.nextCursor !== null;
			const live = this.views.get(id)!;
			view.requests = live.requests;
			if (this.revisions.get(id) !== revision) {
				view.status = live.status;
				view.turnId = live.turnId;
				view.truncated ||= live.truncated;
				for (const item of live.items) if (before.get(item.id) !== item.text) this.put(view, item);
			}
			if (["systemError", "notLoaded"].includes(result.thread.status.type) || view.status === "uncertain") {
				view.status = "uncertain";
				view.requests = [];
				for (const [key, request] of this.pending) if (request.threadId === id) this.pending.delete(key);
			} else if (view.requests.length) view.status = "waiting";
			this.views.set(id, view);
			return this.read(id);
		});
	}
	read(id: string): AgentRuntimeView {
		const view = this.views.get(id);
		if (!view) throw new AgentError("agent-unavailable");
		return structuredClone(view);
	}
	async send(id: string, path: string, text: string): Promise<void> {
		await this.guard(async () => {
			const view = this.views.get(id);
			if (!view || ["running", "waiting", "uncertain"].includes(view.status))
				throw new AgentError("agent-conflict");
			view.status = "running";
			delete view.turnId;
			try {
				const result = z.object({ turn: turnSchema }).parse(
					await this.connection.request("turn/start", {
						threadId: id,
						cwd: path,
						input: [{ type: "text", text, text_elements: [] }],
					}),
				);
				// Completion notifications can precede the RPC response. Do not resurrect a finished turn.
				if (!view.turnId) {
					view.turnId = result.turn.id;
					view.status = this.status(result.turn.status);
				}
			} catch (cause) {
				view.status = "uncertain";
				this.emit(id);
				throw cause;
			}
		});
	}
	async interrupt(id: string, turnId: string): Promise<void> {
		await this.guard(async () => {
			await this.connection.request("turn/interrupt", { threadId: id, turnId });
		});
	}
	reply(id: string, input: AgentReply): void {
		const parsed = agentReplySchema.safeParse(input);
		if (!parsed.success) throw new AgentError("invalid-request");
		const pending = this.pending.get(input.requestId);
		const view = this.views.get(id);
		const request = view?.requests.find((value) => value.id === input.requestId);
		if (!pending || pending.threadId !== id || !view || !request || pending.turnId !== view.turnId)
			throw new AgentError("agent-conflict");
		let result: unknown;
		if (request.kind === "input") {
			if (
				input.decision
				|| !input.answers
				|| Object.keys(input.answers).length !== request.questions.length
				|| request.questions.some((question) => !input.answers?.[question.id])
			)
				throw new AgentError("invalid-request");
			result = {
				answers: Object.fromEntries(
					request.questions.map((question) => [question.id, { answers: [input.answers![question.id]] }]),
				),
			};
		} else {
			if (!input.decision || input.answers) throw new AgentError("invalid-request");
			result = { decision: input.decision };
		}
		try {
			this.connection.respond(pending.rpcId, result);
		} catch (cause) {
			throw new AgentError("agent-unavailable", { cause });
		}
		this.pending.delete(input.requestId);
		view.requests = view.requests.filter((value) => value.id !== input.requestId);
		view.status = view.requests.length ? "waiting" : "running";
		this.emit(id);
	}
	subscribe(listener: (id: string) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private options(path: string) {
		return {
			cwd: path,
			sandbox: "workspace-write",
			approvalPolicy: "on-request",
			config: { features: { multi_agent: false }, sandbox_workspace_write: { network_access: false } },
		};
	}
	private hydrate(thread: z.infer<typeof threadSchema>): AgentRuntimeView {
		const last = thread.turns.at(-1);
		const view: AgentRuntimeView = {
			status: ["systemError", "notLoaded"].includes(thread.status.type)
				? "uncertain"
				: thread.status.type === "active"
					? "running"
					: last
						? this.status(last.status)
						: "idle",
			...(last ? { turnId: last.id } : {}),
			items: [],
			requests: [],
			truncated: false,
		};
		for (const turn of thread.turns) for (const item of turn.items) this.item(view, item);
		return view;
	}
	private status(status: string): AgentRuntimeView["status"] {
		return status === "inProgress"
			? "running"
			: status === "completed"
				? "completed"
				: status === "interrupted"
					? "interrupted"
					: "failed";
	}
	private item(view: AgentRuntimeView, raw: unknown): void {
		const item = z
			.object({
				id: z.string().min(1).max(256),
				type: z.string(),
				text: z.string().optional(),
				command: z.string().optional(),
				aggregatedOutput: z.string().nullish(),
				status: z.string().optional(),
				content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
			})
			.parse(raw);
		const role: AgentItem["role"] =
			item.type === "userMessage" ? "user" : item.type === "agentMessage" ? "assistant" : "activity";
		const text =
			item.type === "userMessage"
				? (item.content ?? []).map((part) => part.text ?? `[${part.type}]`).join("\n")
				: (item.text
					?? (item.type === "commandExecution"
						? `${item.command ?? "Command"}\n${item.aggregatedOutput ?? item.status ?? ""}`
						: `${item.type}${item.status ? `: ${item.status}` : ""}`));
		this.put(view, { id: item.id, role, text });
	}
	private put(view: AgentRuntimeView, item: AgentItem): void {
		if (item.text.length > 32000) {
			item.text = item.text.slice(0, 32000);
			view.truncated = true;
		}
		const index = view.items.findIndex((value) => value.id === item.id);
		if (index >= 0) view.items[index] = item;
		else view.items.push(item);
		// Bound the full browser snapshot as well as individual output.
		while (view.items.length > 500 || view.items.reduce((size, value) => size + value.text.length, 0) > 240000) {
			view.items.shift();
			view.truncated = true;
		}
	}
	private notification(method: string, params: unknown): void {
		if (method === "connection/lost") {
			this.pending.clear();
			for (const [id, view] of this.views) {
				view.status = "uncertain";
				view.requests = [];
				this.emit(id);
			}
			return;
		}
		const envelope = z.object({ threadId: z.string() }).safeParse(params);
		if (!envelope.success) return;
		const id = envelope.data.threadId;
		const view = this.views.get(id);
		if (!view) return;
		try {
			if (method === "thread/status/changed") {
				const { status } = z.object({ status: threadStatusSchema }).parse(params);
				if (!["systemError", "notLoaded"].includes(status.type)) return;
				view.status = "uncertain";
				view.requests = [];
				for (const [key, request] of this.pending) if (request.threadId === id) this.pending.delete(key);
			} else if (method === "serverRequest/resolved") {
				const resolved = z.object({ requestId: z.union([z.string(), z.number()]) }).parse(params);
				for (const [key, request] of this.pending) {
					if (request.threadId !== id || request.rpcId !== resolved.requestId) continue;
					this.pending.delete(key);
					view.requests = view.requests.filter((value) => value.id !== key);
				}
				if (view.status === "waiting" && !view.requests.length) view.status = "running";
			} else if (method === "error") {
				const error = z.object({ turnId: z.string(), willRetry: z.boolean() }).parse(params);
				if (view.turnId && error.turnId !== view.turnId) return;
				if (!error.willRetry) {
					view.turnId = error.turnId;
					view.status = "failed";
					view.requests = [];
				}
			} else if (method === "turn/started" || method === "turn/completed") {
				const { turn } = z.object({ turn: turnSchema }).parse(params);
				view.turnId = turn.id;
				view.status = this.status(turn.status);
				for (const item of turn.items) this.item(view, item);
				if (method === "turn/completed") {
					view.requests = [];
					for (const [key, request] of this.pending) if (request.threadId === id) this.pending.delete(key);
				}
			} else if (method === "item/started" || method === "item/completed") {
				this.item(view, z.object({ item: z.unknown() }).parse(params).item);
			} else if (
				["item/agentMessage/delta", "item/plan/delta", "item/commandExecution/outputDelta"].includes(method)
			) {
				const delta = z.object({ itemId: z.string().min(1).max(256), delta: z.string() }).parse(params);
				const existing = view.items.find((item) => item.id === delta.itemId);
				this.put(view, {
					id: delta.itemId,
					role: method === "item/agentMessage/delta" ? "assistant" : "activity",
					text: (existing?.text ?? "") + delta.delta,
				});
			} else return;
			this.emit(id);
		} catch (err) {
			this.log.warn({ err }, "Invalid Codex activity");
			view.status = "uncertain";
			this.emit(id);
		}
	}
	private serverRequest(rpcId: string | number, method: string, params: unknown): boolean {
		if (
			![
				"item/commandExecution/requestApproval",
				"item/fileChange/requestApproval",
				"item/tool/requestUserInput",
			].includes(method)
		)
			return false;
		try {
			const raw = z
				.object({
					threadId: z.string(),
					turnId: z.string(),
					reason: z.string().nullish(),
					command: z.string().nullish(),
					questions: z
						.array(
							z.object({
								id: z.string().min(1).max(256),
								question: z.string().max(4000),
								isSecret: z.boolean(),
								options: z
									.array(z.object({ label: z.string().max(1000) }))
									.max(20)
									.nullish(),
							}),
						)
						.max(10)
						.optional(),
				})
				.parse(params);
			const view = this.views.get(raw.threadId);
			if (!view || view.requests.length >= 32 || (view.turnId && view.turnId !== raw.turnId)) return false;
			const id = this.generateId();
			const request: AgentRequest = {
				id,
				kind: method.includes("requestUserInput")
					? "input"
					: method.includes("fileChange")
						? "file"
						: "command",
				description: [raw.reason, raw.command].filter(Boolean).join("\n").slice(0, 8000),
				questions: (raw.questions ?? []).map((question) => ({
					id: question.id,
					question: question.question,
					secret: question.isSecret,
					options: question.options?.map((option) => option.label) ?? [],
				})),
			};
			if (request.kind === "input" && !request.questions.length) return false;
			this.pending.set(id, { threadId: raw.threadId, turnId: raw.turnId, rpcId });
			view.turnId = raw.turnId;
			view.requests.push(request);
			view.status = "waiting";
			this.emit(raw.threadId);
			return true;
		} catch (err) {
			this.log.warn({ err }, "Unsupported Codex request");
			return false;
		}
	}
	private emit(id: string): void {
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
		for (const listener of this.listeners) listener(id);
	}
	private async guard<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			if (cause instanceof AgentError) throw cause;
			this.log.warn({ err: cause }, "Codex execution unavailable");
			throw new AgentError("agent-unavailable", { cause });
		}
	}
}

const turnSchema = z.object({
	id: z.string().min(1).max(256),
	status: z.enum(["inProgress", "completed", "interrupted", "failed"]),
	items: z.array(z.unknown()),
});
const threadStatusSchema = z.object({ type: z.enum(["notLoaded", "idle", "active", "systemError"]) });
const threadSchema = z.object({
	id: z.string().min(1).max(256),
	cwd: z.string(),
	historyMode: z.literal("paginated"),
	status: threadStatusSchema,
	turns: z.array(turnSchema),
});
const threadResponse = z.object({ thread: threadSchema });
