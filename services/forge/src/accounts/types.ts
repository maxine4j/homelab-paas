import type { AccountStatus } from "@homelab-paas/forge-contracts";

export type LoginState = AccountStatus["login"];
export type AccountNotification = (method: string, params: unknown) => void;
export interface AccountProcessSpec {
	program: "codex" | "github";
	arguments: string[];
	onOutput: (chunk: string) => void;
	/** Long lived Codex stdout is bounded per frame by its connection. */
	outputLimit?: number;
}
export interface AccountProcessHandle {
	/** Resolves only after child streams close. Rejects on spawn/output failures. */
	done: Promise<number>;
	write(data: string): void;
	/** TERM, bounded grace, KILL entire process group, await stream closure. */
	stop(): Promise<void>;
}
export interface AccountProcessConfiguration {
	dataDirectory: string;
	codexExecutable: string;
	githubExecutable: string;
	path: string;
}
