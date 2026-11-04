import { gitShaSchema } from "@homelab-paas/forge-contracts";

import type { IAgentWorkspaces } from "../agents/agent-service.ts";
import type { Actor } from "../auth/types.ts";
import type { IGitTransport } from "../repositories/git-transport.ts";
import { TicketError } from "../tickets/errors.ts";
import type { ITicketMergeClient } from "../tickets/ticket-workflow-service.ts";

export class WorkspaceMergeClient implements ITicketMergeClient {
	constructor(
		private readonly workspaces: IAgentWorkspaces,
		private readonly git: IGitTransport,
	) {}
	async base(actor: Actor, workspaceId: string): Promise<string> {
		const { workspace } = await this.workspaces.resolve(actor, workspaceId);
		if (!workspace.baseSha) throw new TicketError("ticket-unavailable");
		return workspace.baseSha;
	}
	async merge(actor: Actor, workspaceId: string): Promise<"merged" | "rebase"> {
		try {
			const { path, workspace } = await this.workspaces.resolve(actor, workspaceId);
			if ((await this.git.run(["-C", path, "status", "--porcelain", "--untracked-files=all"])).trim())
				throw new TicketError("ticket-conflict");
			const main = gitShaSchema.parse(
				(await this.git.run(["-C", path, "rev-parse", "--verify", "refs/heads/main"])).trim(),
			);
			const head = gitShaSchema.parse(
				(await this.git.run(["-C", path, "rev-parse", "--verify", `refs/heads/${workspace.branch}`])).trim(),
			);
			const base = gitShaSchema.parse((await this.git.run(["-C", path, "merge-base", main, head])).trim());
			if (base !== main) return "rebase";
			await this.git.run(["-C", path, "update-ref", "refs/heads/main", head, main]);
			return "merged";
		} catch (cause) {
			if (cause instanceof TicketError) throw cause;
			throw new TicketError("ticket-unavailable", { cause });
		}
	}
}
