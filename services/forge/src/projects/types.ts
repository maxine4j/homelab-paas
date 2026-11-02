import type { Project } from "@homelab-paas/forge-contracts";
export interface ProjectRecord extends Project {
	source?: string;
}
