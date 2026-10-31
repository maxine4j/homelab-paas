import type { UiLiveData, UiLiveServerMessage, UiLiveTarget, UiLogs } from "@homelab-paas/shared-contracts";

import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger } from "../util/logger.ts";
import { PaasUiError, type IPaasUiLogService, type IPaasUiService } from "./paas-ui-service.ts";

export interface IUiLiveService {
	/** Initial snapshot followed by invalidations; cancellation suppresses stale delivery and closes log streams. */
	subscribe(id: string, target: UiLiveTarget, receive: (message: UiLiveServerMessage) => void): () => void;
}

export class UiLiveService implements IUiLiveService {
	private readonly log = createLogger(UiLiveService.name);
	constructor(
		private readonly ui: IPaasUiService,
		private readonly logs: IPaasUiLogService,
		private readonly changes: IChangeBus,
	) {}
	subscribe(id: string, target: UiLiveTarget, receive: (message: UiLiveServerMessage) => void): () => void {
		const controller = new AbortController();
		let reading = false;
		let dirty = false;
		let logController: AbortController | undefined;
		const send = (data: UiLiveData): void => {
			if (!controller.signal.aborted) receive({ type: "snapshot", id, target, data });
		};
		const failed = (err: unknown): void => {
			if (controller.signal.aborted) return;
			this.log.error({ err }, "Live inspection failed");
			receive({
				type: "error",
				id,
				message:
					err instanceof PaasUiError && err.kind === "not-found"
						? "Requested item was not found"
						: "Cluster data is unavailable; retry shortly",
			});
		};
		const follow = (): void => {
			if (target.kind !== "logs" && target.kind !== "cluster-logs") return;
			logController?.abort();
			const stream = new AbortController();
			logController = stream;
			const receiveLogs = (data: UiLogs): void => {
				if (!stream.signal.aborted) send(data);
			};
			const following =
				target.kind === "cluster-logs"
					? this.logs.followControlPlaneLogs(receiveLogs, stream.signal)
					: this.logs.followLogs(
							target.serviceId,
							target.resourceId,
							target.containerId,
							receiveLogs,
							stream.signal,
						);
			void following.catch((err) => {
				if (!stream.signal.aborted) failed(err);
			});
		};
		const refresh = async (): Promise<void> => {
			if (controller.signal.aborted) return;
			if (reading) {
				dirty = true;
				return;
			}
			reading = true;
			do {
				dirty = false;
				try {
					send(await this.snapshot(target));
				} catch (err) {
					failed(err);
				}
			} while (dirty && !controller.signal.aborted);
			reading = false;
		};
		const unsubscribe = this.changes.subscribe((change) => {
			if (target.kind === "cluster-logs" && change.serviceId) return;
			if (change.serviceId && "serviceId" in target && change.serviceId !== target.serviceId) return;
			if (change.event && change.serviceId && target.kind === "events")
				receive({ type: "event", serviceId: change.serviceId, event: change.event });
			if (target.kind !== "logs" && target.kind !== "cluster-logs") void refresh();
			else if (!change.serviceId || change.refreshLogs) follow();
		});
		if (target.kind === "logs" || target.kind === "cluster-logs") {
			follow();
		} else void refresh();
		return () => {
			controller.abort();
			logController?.abort();
			unsubscribe();
		};
	}
	private snapshot(target: UiLiveTarget): Promise<UiLiveData> {
		switch (target.kind) {
			case "cluster":
				return this.ui.getCluster();
			case "services":
				return this.ui.listServices();
			case "service":
				return this.ui.getService(target.serviceId);
			case "events":
				return this.ui.getEvents(target.serviceId);
			case "resource":
				return this.ui.getResource(target.serviceId, target.resourceId);
			case "logs":
			case "cluster-logs":
				throw new Error("Log subscriptions require a stream");
		}
	}
}
