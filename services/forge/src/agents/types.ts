import type { AgentThread, AgentRequest } from "@homelab-paas/forge-contracts/agents";
export interface AgentThreadRecord extends AgentThread {
	codexId?: string;
	requests: AgentRequest[];
}
