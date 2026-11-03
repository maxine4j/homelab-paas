import type { AgentItem, AgentRequest, AgentStatus } from "@homelab-paas/forge-contracts/agents";
export interface AgentRuntimeView {
	status: AgentStatus;
	turnId?: string;
	items: AgentItem[];
	requests: AgentRequest[];
	truncated: boolean;
}
