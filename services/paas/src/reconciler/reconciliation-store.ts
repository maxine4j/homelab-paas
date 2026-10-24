import { z } from "zod";

import type { KeyValueStore } from "../store/types.ts";
import type { IReconciliationStateStore, ReconciliationState } from "./types.ts";

export class ReconciliationStore implements IReconciliationStateStore {
	constructor(private readonly store: KeyValueStore<unknown>) {}
	async read(serviceId: string): Promise<ReconciliationState | undefined> {
		const key = `${this.identity(serviceId)}.state`;
		try {
			const value = await this.store.get(key);
			return value === undefined ? undefined : stateSchema.parse(value);
		} catch (cause) {
			throw new Error("Cannot read reconciliation data; check platform state files and permissions", { cause });
		}
	}
	async write(serviceId: string, state: ReconciliationState): Promise<void> {
		const key = `${this.identity(serviceId)}.state`;
		try {
			await this.store.set(key, stateSchema.parse(state));
		} catch (cause) {
			throw new Error("Cannot write reconciliation data; check platform state directory permissions", { cause });
		}
	}

	private identity(serviceId: string): string {
		if (!id.safeParse(serviceId).success) throw new Error("Invalid reconciliation service identity");
		return serviceId;
	}
}

const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const stateSchema = z.strictObject({
	desiredRevision: z.string().optional(),
	activeRevision: z.string().optional(),
	phase: z
		.enum(["pending", "deploying", "ready", "failed"])
		.transform((phase) => (phase === "pending" ? ("deploying" as const) : phase)),
	error: z.string().optional(),
	failures: z.number().int().nonnegative().max(1024).optional(),
	retryAt: z.number().finite().nonnegative().optional(),
});
