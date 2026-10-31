import type { UiServiceEvent } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import type { KeyValueStore } from "../store/types.ts";

export interface IServiceEventStore {
	/** Appends a safe event, retaining the latest 200. Writes are serialized; failures propagate. */
	append(serviceId: string, event: UiServiceEvent): Promise<void>;
	/** Newest first. Missing history is empty; invalid or unreadable history throws. */
	list(serviceId: string): Promise<UiServiceEvent[]>;
}

export class ServiceEventStore implements IServiceEventStore {
	private pending: Promise<void> = Promise.resolve();
	constructor(private readonly store: KeyValueStore<unknown>) {}
	append(serviceId: string, event: UiServiceEvent): Promise<void> {
		const operation = this.pending.then(async () => {
			const key = this.key(serviceId);
			try {
				const next = eventSchema.parse(event);
				await this.store.update(key, async (value) =>
					[...historySchema.parse(value === undefined ? [] : value), next].slice(-200),
				);
			} catch (cause) {
				throw new Error("Cannot append service event; check platform event history and directory permissions", {
					cause,
				});
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}
	async list(serviceId: string): Promise<UiServiceEvent[]> {
		const key = this.key(serviceId);
		try {
			const value = await this.store.get(key);
			return historySchema.parse(value === undefined ? [] : value).reverse();
		} catch (cause) {
			throw new Error("Cannot read service events; check platform event history and permissions", { cause });
		}
	}

	private key(serviceId: string): string {
		if (!identity.safeParse(serviceId).success) throw new Error("Invalid service event identity");
		return `${serviceId}.events`;
	}
}

const identity = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const eventSchema = z.strictObject({
	timestamp: z.number().finite().nonnegative(),
	level: z.enum(["info", "error"]),
	event: z.enum([
		"deployment.started",
		"reconciliation.failed",
		"reconciliation.state-failed",
		"reconciliation.recovered",
		"deployment.succeeded",
	]),
	message: z.string().min(1).max(4096),
	diagnostics: z
		.string()
		.max(32768)
		.refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 32768)
		.optional(),
	resourceId: identity.optional(),
	revision: z.string().max(256).optional(),
	failures: z.number().int().nonnegative().max(1024).optional(),
	retryAt: z.number().finite().nonnegative().optional(),
	secretFailure: z
		.strictObject({
			reason: z.enum(["missing-file", "unreadable-file", "invalid-file", "missing-variables"]),
			filePath: z
				.string()
				.startsWith("/")
				.max(4096)
				.regex(/^[^\0\r\n]+$/),
			hostFilePath: z
				.string()
				.startsWith("/")
				.max(4096)
				.regex(/^[^\0\r\n]+$/)
				.optional(),
			missingVariables: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).optional(),
			line: z.number().int().positive().optional(),
		})
		.optional(),
});
const historySchema = z.array(eventSchema).max(200);
