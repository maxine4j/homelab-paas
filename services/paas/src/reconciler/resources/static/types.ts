import type { StaticResource } from "@homelab-paas/shared-contracts";

import type { GitFileSource } from "../../../git/types.ts";

export interface StaticReconciliationRequest {
	serviceId: string;
	resourceId: string;
	revision: string;
	source: GitFileSource;
	resource: StaticResource;
	force?: boolean;
}
