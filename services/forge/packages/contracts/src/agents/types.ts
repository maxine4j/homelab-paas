export type AgentStatus =
	| "creating"
	| "idle"
	| "running"
	| "waiting"
	| "completed"
	| "interrupted"
	| "failed"
	| "uncertain";
export interface AgentItem {
	id: string;
	role: "user" | "assistant" | "activity";
	text: string;
}
export interface AgentQuestion {
	id: string;
	question: string;
	secret: boolean;
	options: string[];
}
export interface AgentRequest {
	id: string;
	kind: "command" | "file" | "input";
	description: string;
	questions: AgentQuestion[];
}
export interface AgentThread {
	id: string;
	projectId: string;
	workspaceId: string;
	title: string;
	createdAt: string;
	status: AgentStatus;
	turnId?: string;
}
export interface AgentView {
	thread: AgentThread;
	items: AgentItem[];
	requests: AgentRequest[];
	truncated: boolean;
}
export interface AgentReply {
	requestId: string;
	decision?: "accept" | "decline";
	answers?: Record<string, string>;
}
