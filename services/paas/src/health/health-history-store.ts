import type { HealthStatus, UiHealthTimeline } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import type { KeyValueStore } from "../store/types.ts";

export interface IHealthHistoryStore {
	/** Oldest-first bounded observation periods; missing history is empty. Invalid data throws. */
	read(serviceId: string): Promise<Record<string, UiHealthTimeline>>;
	/** Serializes observation writes. Discontinuities leave unknown gaps. Failures propagate. */
	record(serviceId: string, health: Record<string, HealthStatus>, at: number, discontinuity: boolean): Promise<void>;
}

export class HealthHistoryStore implements IHealthHistoryStore {
	private pending: Promise<void> = Promise.resolve();
	constructor(private readonly store: KeyValueStore<unknown>) {}

	async read(serviceId: string): Promise<Record<string, UiHealthTimeline>> {
		const key = this.key(serviceId);
		try {
			return historySchema.parse((await this.store.get(key)) ?? {});
		} catch (cause) {
			throw new Error("Cannot read health history; check platform state and permissions", { cause });
		}
	}

	record(serviceId: string, health: Record<string, HealthStatus>, at: number, discontinuity: boolean): Promise<void> {
		const operation = this.pending.then(async () => {
			const key = this.key(serviceId);
			try {
				await this.store.update(key, async (value) => {
					const previous = historySchema.parse(value ?? {});
					const next: Record<string, UiHealthTimeline> = {};
					for (const [id, status] of Object.entries(health)) {
						const timeline = previous[id];
						const periods = timeline?.periods.filter(({ end }) => end >= at - 86_400_000) ?? [];
						const last = periods.at(-1);
						if (timeline && at < timeline.observedAt) throw new Error("Health observation moved backwards");
						if (last && !discontinuity && at - last.end <= 90_000) {
							last.end = at;
							if (last.health !== status) periods.push({ start: at, end: at, health: status });
						} else periods.push({ start: at, end: at, health: status });
						next[id] = {
							observedAt: at,
							periods: periods
								.slice(-2000)
								.map((period) => ({ ...period, start: Math.max(period.start, at - 86_400_000) })),
						};
					}
					return historySchema.parse(next);
				});
			} catch (cause) {
				throw new Error("Cannot record health history; check platform state and permissions", { cause });
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}

	private key(serviceId: string): string {
		if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId) || serviceId.length > 63)
			throw new Error("Invalid health history identity");
		return `${serviceId}.health`;
	}
}

const timestamp = z.number().finite().nonnegative();
const period = z
	.strictObject({
		start: timestamp,
		end: timestamp,
		health: z.enum(["Healthy", "Progressing", "Degraded", "Missing", "Unknown", "Paused"]),
	})
	.refine(({ start, end }) => end >= start);
const timeline = z
	.strictObject({ observedAt: timestamp, periods: z.array(period).max(2000) })
	.refine(({ observedAt, periods }) =>
		periods.every(
			(entry, index) => entry.end <= observedAt && (index === 0 || entry.start >= periods.at(index - 1)!.end),
		),
	);
const historySchema = z.record(
	z
		.string()
		.regex(/^(?:\$service|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/)
		.max(63),
	timeline,
);
