// service layer class that runs busniess logic of reconsiling the cluster

export interface IReconcilerService {
	reconcile(): Promise<void>;
}

export class ReconcilerService implements IReconcilerService {
	async reconcile(): Promise<void> {
		// this is where we orchestrate pulling git repos and decide if we want to re-deploy services or otherwise mutate live cluster state to make it match the declarative descriptors
	}
}
