import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import type { Workspace, CreateWorkspace } from "@homelab-paas/forge-contracts";
import {
	agentThreadSchema,
	createAgentSchema,
	agentMessageSchema,
	type AgentThread,
	type AgentView,
	type AgentReply,
} from "@homelab-paas/forge-contracts/agents";

import type { IAccessService } from "../auth/access-service.ts";
import type { Actor } from "../auth/types.ts";
import type { ICodexAgentClient } from "../codex/codex-agent-client.ts";
import type { IProjectService } from "../projects/project-service.ts";
import type { WorkspaceLocation } from "../workspaces/types.ts";
import type { IAgentThreadStore } from "./agent-thread-store.ts";
import { AgentError } from "./errors.ts";
import type { AgentThreadRecord } from "./types.ts";
export interface IAgentWorkspaces {
	create(actor: Actor, projectId: string, input: CreateWorkspace): Promise<Workspace>;
	resolve(actor: Actor, id: string): Promise<WorkspaceLocation>;
}
export interface IAgentService {
	/** Owner-only. Creates a dedicated workspace; Codex identifiers stay private. Throws AgentError. */
	create(actor: Actor, projectId: string, title: string): Promise<AgentView>;
	list(actor: Actor, projectId: string): Promise<AgentThread[]>;
	get(actor: Actor, id: string): Promise<AgentView>;
	send(actor: Actor, id: string, text: string): Promise<AgentView>;
	resume(actor: Actor, id: string): Promise<AgentView>;
	interrupt(actor: Actor, id: string): Promise<AgentView>;
	reply(actor: Actor, id: string, input: AgentReply): Promise<AgentView>;
	subscribe(actor: Actor, id: string, listener: () => void): Promise<() => void>;
	shutdown(): Promise<void>;
}
export class AgentService implements IAgentService {
	private readonly log = createLogger(AgentService.name);
	private readonly queues = new Map<string, Promise<unknown>>();
	private readonly identities = new Map<string, string>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly unsubscribe: () => void;
	private closed = false;
	constructor(
		private readonly store: IAgentThreadStore,
		private readonly client: ICodexAgentClient,
		private readonly workspaces: IAgentWorkspaces,
		private readonly projects: IProjectService,
		private readonly access: IAccessService,
		private readonly generateId: () => string,
		private readonly now: () => Date,
	) {
		this.unsubscribe = client.subscribe((codexId) => {
			const id = this.identities.get(codexId);
			if (!id || this.closed) return;
			void this.serialize(id, async () => {
				await this.sync(await this.require(id));
				for (const listener of this.listeners.get(id) ?? []) listener();
			}).catch((err: unknown) => this.log.error({ err }, "Could not persist agent activity"));
		});
	}
	async create(actor: Actor, projectId: string, title: string): Promise<AgentView> {
		this.authorize(actor);
		const input = createAgentSchema.safeParse({ title });
		if (!input.success) throw new AgentError("invalid-request");
		const id = this.generateId();
		return this.serialize(id, async () => {
			const workspace = await this.workspaces.create(actor, projectId, { name: input.data.title });
			const record: AgentThreadRecord = {
				id,
				projectId,
				workspaceId: workspace.id,
				title: input.data.title,
				createdAt: this.now().toISOString(),
				status: "idle",
				requests: [],
			};
			await this.store.insert(record);
			return this.view(record);
		});
	}
	async list(actor: Actor, projectId: string): Promise<AgentThread[]> {
		this.authorize(actor);
		await this.projects.get(actor, projectId);
		return (await this.store.list(projectId)).map((record) => agentThreadSchema.parse(this.view(record).thread));
	}
	async get(actor: Actor, id: string): Promise<AgentView> {
		this.authorize(actor);
		return this.serialize(id, async () => this.view(await this.require(id)));
	}
	async send(actor: Actor, id: string, text: string): Promise<AgentView> {
		this.authorize(actor);
		const input = agentMessageSchema.safeParse({ text });
		if (!input.success) throw new AgentError("invalid-request");
		return this.serialize(id, async () => {
			const record = await this.require(id);
			if (["creating", "running", "waiting", "uncertain"].includes(record.status))
				throw new AgentError("agent-conflict");
			const location = await this.workspaces.resolve(actor, record.workspaceId);
			try {
				if (!record.codexId) {
					record.status = "creating";
					await this.store.update(record);
					record.codexId = await this.client.start(location.path);
					this.identities.set(record.codexId, id);
				}
				record.status = "running";
				await this.store.update(record);
				await this.client.send(record.codexId, location.path, input.data.text);
				return await this.sync(record);
			} catch (cause) {
				record.status = "uncertain";
				await this.store.update(record);
				throw cause;
			}
		});
	}
	async resume(actor: Actor, id: string): Promise<AgentView> {
		this.authorize(actor);
		return this.serialize(id, async () => {
			const record = await this.require(id);
			if (!record.codexId) {
				if (record.status === "idle") return this.view(record);
				throw new AgentError("agent-conflict");
			}
			const location = await this.workspaces.resolve(actor, record.workspaceId);
			await this.client.resume(record.codexId, location.path);
			this.identities.set(record.codexId, id);
			return this.sync(record);
		});
	}
	async interrupt(actor: Actor, id: string): Promise<AgentView> {
		this.authorize(actor);
		return this.serialize(id, async () => {
			const record = await this.require(id);
			if (!record.codexId || !record.turnId || !["running", "waiting"].includes(record.status))
				throw new AgentError("agent-conflict");
			await this.client.interrupt(record.codexId, record.turnId);
			return this.sync(record);
		});
	}
	async reply(actor: Actor, id: string, input: AgentReply): Promise<AgentView> {
		this.authorize(actor);
		return this.serialize(id, async () => {
			const record = await this.require(id);
			if (!record.codexId || record.status !== "waiting") throw new AgentError("agent-conflict");
			await this.workspaces.resolve(actor, record.workspaceId);
			this.client.reply(record.codexId, input);
			return this.sync(record);
		});
	}
	async subscribe(actor: Actor, id: string, listener: () => void): Promise<() => void> {
		this.authorize(actor);
		await this.require(id);
		const listeners = this.listeners.get(id) ?? new Set();
		this.listeners.set(id, listeners);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (!listeners.size) this.listeners.delete(id);
		};
	}
	async shutdown(): Promise<void> {
		this.closed = true;
		this.unsubscribe();
		await Promise.allSettled([...this.queues.values()]);
		this.listeners.clear();
	}
	private authorize(actor: Actor): void {
		this.access.assertOwner(actor);
		if (this.closed) throw new AgentError("agent-unavailable");
	}
	private async require(id: string): Promise<AgentThreadRecord> {
		const record = await this.store.get(id);
		if (!record) throw new AgentError("agent-not-found");
		return record;
	}
	private view(record: AgentThreadRecord): AgentView {
		let runtime;
		try {
			if (record.codexId && this.identities.has(record.codexId)) runtime = this.client.read(record.codexId);
		} catch {}
		const { codexId: _codexId, requests, ...thread } = record;
		return {
			thread,
			items: runtime?.items ?? [],
			requests: runtime?.requests ?? requests,
			truncated: runtime?.truncated ?? false,
		};
	}
	private async sync(record: AgentThreadRecord): Promise<AgentView> {
		if (record.codexId) {
			const runtime = this.client.read(record.codexId);
			const updated = { ...record, status: runtime.status, turnId: runtime.turnId, requests: runtime.requests };
			if (JSON.stringify(updated) !== JSON.stringify(record)) await this.store.update(updated);
			return this.view(updated);
		}
		return this.view(record);
	}
	private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const result = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
		this.queues.set(id, result);
		void result
			.finally(() => {
				if (this.queues.get(id) === result) this.queues.delete(id);
			})
			.catch(() => {});
		return result;
	}
}
