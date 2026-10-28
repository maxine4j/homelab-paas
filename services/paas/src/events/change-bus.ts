import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import { createLogger } from "../util/logger.ts";

export interface PlatformChange {
	serviceId?: string;
	refreshLogs?: boolean;
	event?: UiServiceEvent;
}
export interface IChangeBus {
	publish(change: PlatformChange): void;
	subscribe(receive: (change: PlatformChange) => void): () => void;
}

/** Best-effort invalidation. Observers cannot fail the operation they observe. */
export class ChangeBus implements IChangeBus {
	private readonly log = createLogger(ChangeBus.name);
	private readonly subscribers = new Set<(change: PlatformChange) => void>();
	publish(change: PlatformChange): void {
		for (const receive of this.subscribers) {
			try {
				receive(change);
			} catch (err) {
				this.log.error({ err }, "Platform change observer failed");
			}
		}
	}
	subscribe(receive: (change: PlatformChange) => void): () => void {
		this.subscribers.add(receive);
		return () => {
			this.subscribers.delete(receive);
		};
	}
}
