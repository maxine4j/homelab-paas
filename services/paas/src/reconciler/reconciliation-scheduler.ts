import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import { createLogger, withLogContext } from "../util/logger.ts";
import type { ISleep } from "../util/sleep.ts";
import { RedeployError, type IServiceRedeployer, type ITargetedReconciler } from "./reconciler-service.ts";
import type { IReconciliationStateStore } from "./types.ts";

export interface IDesiredInputRefresh {
	/** Re-observes committed inputs and secrets; returns whether accepted input identity changed. */
	refresh(serviceId: string): Promise<boolean>;
	invalidate(serviceId: string): void;
}

export interface IReconciliationScheduler extends IServiceRedeployer {
	/** Subscribes to desired writes before APIs/audits accept work, while execution remains gated. */
	initialize(): void;
	/** Coalesced observation hint. Does not discard desired inputs or bypass persisted backoff. */
	invalidate(serviceId: string): void;
	/** Re-reads desired inputs, scheduling only changed/invalid inputs. Failures are checkpointed by reconciliation. */
	refreshInputs(serviceId: string): Promise<void>;
	/** Explicit gate: callers establish event subscription/audit before starting work. */
	start(): Promise<void>;
	/** Settles immediate queued work, without waiting for future retry deadlines. */
	settle(): Promise<void>;
	/** Cancels timers/discards pending hints and waits for active deployment work. */
	stop(): Promise<void>;
}

export class ReconciliationScheduler implements IReconciliationScheduler {
	private readonly log = createLogger(ReconciliationScheduler.name);
	private readonly dirty = new Set<string>();
	private readonly deadlines = new Map<string, number>();
	private readonly forced = new Map<string, { resolve: () => void; reject: (error: unknown) => void }[]>();
	private readonly refreshes = new Map<string, Promise<void>>();
	private readonly refreshAgain = new Set<string>();
	private running: Promise<void> | undefined;
	private timer: AbortController | undefined;
	private timerWork: Promise<void> | undefined;
	private started = false;
	private stopped = false;
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly config: IPaasConfig,
		private readonly reconciler: ITargetedReconciler,
		private readonly state: IReconciliationStateStore,
		private readonly inputs: IDesiredInputRefresh,
		private readonly sleep: ISleep,
		private readonly now: () => number,
		private readonly generateTaskId: () => string,
		private readonly changes?: IChangeBus,
	) {}

	initialize(): void {
		if (this.unsubscribe || this.stopped) return;
		this.unsubscribe = this.changes?.subscribe((change) => {
			if (!change.desiredInputs) return;
			for (const id of change.serviceId ? [change.serviceId] : Object.keys(this.config.getServices()))
				void this.refreshInputs(id);
		});
	}

	async start(): Promise<void> {
		if (this.started || this.stopped) return;
		this.initialize();
		for (const id of Object.keys(this.config.getServices())) await this.recoverDeadline(id);
		if (this.stopped) return;
		this.started = true;
		this.dispatch();
	}

	invalidate(serviceId: string): void {
		if (this.stopped || !Object.hasOwn(this.config.getServices(), serviceId)) return;
		this.dirty.add(serviceId);
		this.dispatch();
	}

	refreshInputs(serviceId: string): Promise<void> {
		if (this.stopped || !Object.hasOwn(this.config.getServices(), serviceId)) return Promise.resolve();
		const pending = this.refreshes.get(serviceId);
		if (pending) {
			this.refreshAgain.add(serviceId);
			this.inputs.invalidate(serviceId);
			return pending;
		}
		const operation = this.refreshDesired(serviceId).finally(() => this.refreshes.delete(serviceId));
		this.refreshes.set(serviceId, operation);
		return operation;
	}

	redeploy(serviceId: string): Promise<void> {
		if (!Object.hasOwn(this.config.getServices(), serviceId)) return Promise.reject(new RedeployError("not-found"));
		if (this.stopped) return Promise.reject(new RedeployError("unavailable"));
		this.inputs.invalidate(serviceId);
		const result = new Promise<void>((resolve, reject) => {
			const waiters = this.forced.get(serviceId) ?? [];
			waiters.push({ resolve, reject });
			this.forced.set(serviceId, waiters);
		});
		this.invalidate(serviceId);
		return result;
	}

	async settle(): Promise<void> {
		while (this.running || this.refreshes.size) {
			await Promise.all(this.refreshes.values());
			await this.running;
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.unsubscribe?.();
		this.timer?.abort();
		this.dirty.clear();
		for (const waiters of this.forced.values())
			for (const waiter of waiters) waiter.reject(new RedeployError("unavailable"));
		this.forced.clear();
		await this.settle();
		await this.timerWork;
	}

	private dispatch(): void {
		if (!this.started || this.stopped || this.running) return;
		this.timer?.abort();
		this.running = Promise.resolve()
			.then(() => this.drain())
			.finally(() => {
				this.running = undefined;
				if (this.dirty.size && !this.stopped) this.dispatch();
				else this.armTimer();
			});
	}

	private async refreshDesired(serviceId: string): Promise<void> {
		do {
			this.refreshAgain.delete(serviceId);
			try {
				if (await this.inputs.refresh(serviceId)) this.invalidate(serviceId);
			} catch {
				// The reconciler records/redacts the actual invalid input and retains its retry policy.
				this.invalidate(serviceId);
			}
		} while (!this.stopped && this.refreshAgain.has(serviceId));
		this.refreshAgain.delete(serviceId);
	}

	private async drain(): Promise<void> {
		while (this.dirty.size && !this.stopped) {
			const serviceId = this.dirty.values().next().value!;
			this.dirty.delete(serviceId);
			if (!Object.hasOwn(this.config.getServices(), serviceId)) {
				this.deadlines.delete(serviceId);
				continue;
			}
			const waiters = this.forced.get(serviceId);
			this.forced.delete(serviceId);
			if (!waiters && (this.deadlines.get(serviceId) ?? 0) > this.now()) continue;
			await withLogContext({ task: "reconciliation", taskId: this.generateTaskId() }, async () => {
				let fallback: number | undefined;
				try {
					if (waiters) await this.reconciler.redeploy(serviceId);
					else await this.reconciler.reconcileOne(serviceId);
					for (const waiter of waiters ?? []) waiter.resolve();
				} catch (error) {
					for (const waiter of waiters ?? []) waiter.reject(error);
					this.log.error({ err: error, serviceId }, "Targeted reconciliation failed; retrying after backoff");
					fallback = this.now() + this.config.getReconciliationConfig().retryBackoffSeconds * 1000;
				}
				await this.recoverDeadline(serviceId, fallback);
			});
		}
	}

	private async recoverDeadline(serviceId: string, fallback?: number): Promise<void> {
		try {
			const checkpoint = await this.state.read(serviceId);
			if (fallback !== undefined) this.deadlines.set(serviceId, Math.max(checkpoint?.retryAt ?? 0, fallback));
			else if (checkpoint?.retryAt !== undefined)
				this.deadlines.set(serviceId, Math.max(checkpoint.retryAt, this.now()));
			else this.deadlines.delete(serviceId);
		} catch (error) {
			this.log.error({ err: error, serviceId }, "Cannot recover retry checkpoint; retrying after backoff");
			this.deadlines.set(
				serviceId,
				this.now() + this.config.getReconciliationConfig().retryBackoffSeconds * 1000,
			);
		}
	}

	private armTimer(): void {
		if (this.stopped || !this.started || !this.deadlines.size) return;
		const due = Math.min(...this.deadlines.values());
		const timer = new AbortController();
		this.timer = timer;
		this.timerWork = this.sleep(Math.max(0, due - this.now()), timer.signal)
			.then(() => {
				if (timer.signal.aborted || this.stopped) return;
				for (const [id, deadline] of this.deadlines) {
					if (deadline <= this.now()) {
						this.deadlines.delete(id);
						this.dirty.add(id);
					}
				}
				this.dispatch();
			})
			.catch((error: unknown) => {
				if (!timer.signal.aborted) this.log.error({ err: error }, "Retry timer failed");
			});
	}
}
