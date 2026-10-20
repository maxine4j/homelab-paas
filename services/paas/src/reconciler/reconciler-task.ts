import type { PeriodicTask } from "../task/periodic.ts";
import type { IReconcilerService } from "./reconciler-service.ts";

export class ReconcilerTask implements PeriodicTask {
	constructor(private readonly reconcilerService: IReconcilerService) {}

	async run(): Promise<void> {
		await this.reconcilerService.reconcile();
	}
}
