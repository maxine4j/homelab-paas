export interface CreateProject {
	name: string;
	source?: string;
}
export interface Project {
	id: string;
	name: string;
	status: "creating" | "ready" | "failed";
	createdAt: string;
}

export type AccountProvider = "codex" | "github";
export interface AccountStatus {
	connection: "available" | "unavailable";
	account?: { name: string };
	login: {
		state: "idle" | "pending" | "completed" | "failed" | "cancelled" | "uncertain";
		verificationUrl?: string;
		userCode?: string;
		/** Fixed actionable code; never CLI diagnostics. */
		failure?: "login-failed" | "verification-failed" | "connection-lost" | "unavailable";
	};
}
export interface AccountsStatus {
	codex: AccountStatus;
	github: AccountStatus;
}
