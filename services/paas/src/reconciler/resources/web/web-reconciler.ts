// responsible for detecting drift between current live state in the cluster and the desired state according to the service descriptor
// responsible for adjusting live state to match descriptor state

import type { ResourceReconciler } from "../types.ts";

export class WebResourceReconciler implements ResourceReconciler {
	constructor(private readonly deploymentService: IDeploymentService) {}

	async reconcile(): Promise<void> {}
}
