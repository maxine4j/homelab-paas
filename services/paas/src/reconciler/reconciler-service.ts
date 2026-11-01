import type { WebResource, WorkerResource, UiServiceEvent } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import type { GitFileSource } from "../git/types.ts";
import type { IReconciliationMetrics } from "../metrics/metrics-service.ts";
import { createLogger } from "../util/logger.ts";
import { DesiredInputError, type IDesiredInputs } from "./desired-inputs.ts";
import { EnvironmentResolutionError } from "./environment-resolver.ts";
import type { IEventDiagnostics } from "./event-diagnostics.ts";
import type { IWebResourceReconciler } from "./resources/web/web-reconciler.ts";
import type { IWorkerResourceReconciler } from "./resources/worker/worker-reconciler.ts";
import type { IServiceEventStore } from "./service-event-store.ts";
import { serviceEventMessages } from "./types.ts";
import type { IReconcilerService, IReconciliationStateStore, ReconciliationState } from "./types.ts";

export interface IServiceRedeployer {
	/** Serializes with reconciliation; validates inputs before forcing all workloads through their rollout strategy. Throws RedeployError. */
	redeploy(serviceId: string): Promise<void>;
}

export interface ITargetedReconciler extends IServiceRedeployer {
	/** Serialized fresh Docker observation using cached desired inputs; persisted backoff remains authoritative. */
	reconcileOne(serviceId: string): Promise<void>;
}

export class RedeployError extends Error {
	constructor(
		readonly kind: "not-found" | "unavailable",
		options?: ErrorOptions,
	) {
		super(
			kind === "not-found"
				? "Service is not configured"
				: "Cannot redeploy service; inspect service status and events",
			options,
		);
	}
}

export class ReconcilerService implements IReconcilerService, ITargetedReconciler {
	private readonly log = createLogger(ReconcilerService.name);
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly config: IPaasConfig,
		private readonly inputs: IDesiredInputs,
		private readonly web: IWebResourceReconciler,
		private readonly state: IReconciliationStateStore,
		private readonly now: () => number,
		private readonly worker: IWorkerResourceReconciler,
		private readonly events: IServiceEventStore,
		private readonly diagnostics: IEventDiagnostics,
		private readonly changes?: IChangeBus,
		private readonly metrics?: IReconciliationMetrics,
	) {}

	reconcile(): Promise<void> {
		const operation = this.pending.then(async () => {
			for (const [serviceId, source] of Object.entries(this.config.getServices())) {
				try {
					this.inputs.invalidate(serviceId);
					await this.reconcileService(serviceId, source);
				} catch (error) {
					await this.recordStateFailure(serviceId, error);
				}
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}

	reconcileOne(serviceId: string): Promise<void> {
		const operation = this.pending.then(async () => {
			const source = this.config.getServices()[serviceId];
			if (!source || !Object.hasOwn(this.config.getServices(), serviceId)) return;
			try {
				await this.reconcileService(serviceId, source);
			} catch (error) {
				await this.recordStateFailure(serviceId, error);
				throw error;
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}

	redeploy(serviceId: string): Promise<void> {
		const operation = this.pending.then(async () => {
			const sources = this.config.getServices();
			if (!Object.hasOwn(sources, serviceId)) throw new RedeployError("not-found");
			try {
				this.inputs.invalidate(serviceId);
				await this.reconcileService(serviceId, sources[serviceId]!, true);
			} catch (cause) {
				throw new RedeployError("unavailable", { cause });
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}

	private async reconcileService(serviceId: string, source: GitFileSource, force = false): Promise<void> {
		const started = this.now();
		let previous: ReconciliationState | undefined;
		try {
			previous = await this.state.read(serviceId);
		} catch (error) {
			this.metrics?.reconciliation(serviceId, undefined, "failure", (this.now() - started) / 1000);
			throw error;
		}
		if (!force && (previous?.retryAt ?? 0) > this.now()) return;
		let outcome: "success" | "failure" = "failure";
		let desiredRevision = previous?.desiredRevision;
		let deploymentStartedAt = previous?.deploymentStartedAt;
		let message: string = serviceEventMessages.fetch;
		let resourceId: string | undefined;
		let image: string | undefined;
		let resourceContext: WebResource | WorkerResource | undefined;
		const secrets: string[] = [];
		try {
			const desired = await this.inputs.read(serviceId);
			desiredRevision = desired.revision;
			if (previous?.desiredRevision !== desiredRevision) deploymentStartedAt = undefined;
			secrets.push(...desired.secrets);
			const resources = desired.resources;
			resourceId = undefined;
			resourceContext = undefined;
			image = undefined;
			if (previous?.desiredRevision !== desiredRevision)
				this.log.info(
					{ event: "reconciliation.revision", serviceId, revision: desiredRevision },
					"Detected new valid descriptor revision; reconciling resources",
				);
			message = serviceEventMessages.state;
			if (previous?.activeRevision !== desiredRevision) deploymentStartedAt ??= this.now();
			await this.checkpoint(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase:
					previous?.phase === "ready" && previous.activeRevision === desiredRevision ? "ready" : "deploying",
				deploymentStartedAt,
				failures: previous?.desiredRevision === desiredRevision ? previous.failures : undefined,
				retryAt: previous?.retryAt,
			});
			if (
				(previous?.activeRevision !== desiredRevision && previous?.deploymentStartedAt === undefined)
				|| previous?.desiredRevision !== desiredRevision
			)
				await this.recordEvent(serviceId, {
					timestamp: this.now(),
					level: "info",
					event: "deployment.started",
					message: serviceEventMessages.started,
					revision: desiredRevision,
				});
			for (const [id, resource] of resources) {
				resourceId = id;
				image = resource.image;
				resourceContext = resource;
				if (resource.type === "web") {
					message = serviceEventMessages.web;
					await this.web.reconcile({
						serviceId,
						resourceId: id,
						revision: desiredRevision,
						resource,
						...(force ? { force } : {}),
					});
				} else {
					message = serviceEventMessages.worker;
					await this.worker.reconcile({
						serviceId,
						resourceId: id,
						revision: desiredRevision,
						resource,
						...(force ? { force } : {}),
					});
				}
			}
			resourceId = undefined;
			resourceContext = undefined;
			image = undefined;
			message = serviceEventMessages.state;
			await this.checkpoint(serviceId, { desiredRevision, activeRevision: desiredRevision, phase: "ready" });
			const recovered = (previous?.failures ?? 0) > 0 || previous?.phase === "failed";
			if (recovered || previous?.activeRevision !== desiredRevision)
				await this.recordEvent(serviceId, {
					timestamp: this.now(),
					level: "info",
					event: recovered ? "reconciliation.recovered" : "deployment.succeeded",
					message: recovered ? serviceEventMessages.recovered : serviceEventMessages.ready,
					revision: desiredRevision,
				});
			if (recovered)
				this.log.info(
					{ event: "reconciliation.recovered", serviceId, revision: desiredRevision },
					"Service recovered; clearing retry backoff",
				);
			outcome = "success";
		} catch (failure) {
			let error = failure;
			if (failure instanceof DesiredInputError) {
				message = serviceEventMessages[failure.stage];
				desiredRevision = failure.revision ?? desiredRevision;
				if (previous?.desiredRevision !== desiredRevision) deploymentStartedAt = undefined;
				resourceId = failure.resourceId;
				error = failure.cause;
			}
			const retry = this.config.getReconciliationConfig();
			const failures = Math.min(
				(previous?.desiredRevision === desiredRevision ? (previous?.failures ?? 0) : 0) + 1,
				1024,
			);
			const delay =
				Math.min(
					retry.maxRetryBackoffSeconds,
					this.config.getReconciliationConfig().retryBackoffSeconds * 2 ** (failures - 1),
				) * 1000;
			const retryAt = this.now() + delay;
			await this.recordEvent(serviceId, {
				timestamp: this.now(),
				level: "error",
				event: "reconciliation.failed",
				message: this.diagnostics.summarize(error, secrets),
				diagnostics: this.diagnostics.describe(
					error,
					{
						operation: Object.entries(serviceEventMessages).find(([, value]) => value === message)?.[0],
						serviceId,
						source,
						resourceId,
						revision: desiredRevision,
						activeRevision: previous?.activeRevision,
						image,
						resource: resourceContext,
						force,
					},
					secrets,
				),
				...(message === serviceEventMessages.secrets && error instanceof EnvironmentResolutionError
					? { secretFailure: error.details }
					: {}),
				resourceId,
				revision: desiredRevision,
				failures,
				retryAt,
			});
			this.log.error(
				{ event: "reconciliation.failed", serviceId, failures, retryAt, err: error },
				`${message}; retry scheduled`,
			);
			await this.checkpoint(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase:
					(message === serviceEventMessages.web || message === serviceEventMessages.worker)
					&& previous?.activeRevision !== desiredRevision
					&& deploymentStartedAt !== undefined
					&& this.now() - deploymentStartedAt < 300_000
						? "deploying"
						: "failed",
				deploymentStartedAt,
				error: message,
				failures,
				retryAt,
			});
			if (force) throw error;
		} finally {
			this.metrics?.reconciliation(serviceId, desiredRevision, outcome, (this.now() - started) / 1000);
		}
	}

	private async checkpoint(serviceId: string, next: ReconciliationState): Promise<void> {
		const previous = await this.state.read(serviceId);
		const identity = (state: ReconciliationState | undefined): string | undefined =>
			state && JSON.stringify(state, Object.keys(state).sort());
		if (identity(previous) === identity(next)) return;
		await this.state.write(serviceId, next);
		this.changes?.publish({ serviceId });
	}

	private async recordStateFailure(serviceId: string, error: unknown): Promise<void> {
		await this.recordEvent(serviceId, {
			timestamp: this.now(),
			level: "error",
			event: "reconciliation.state-failed",
			message: this.diagnostics.summarize(error, []),
			diagnostics: this.diagnostics.describe(error, { operation: "state", serviceId }, []),
		});
		this.log.error(
			{ event: "reconciliation.state-failed", serviceId, err: error },
			"Cannot persist reconciliation state; check platform state directory access",
		);
	}

	private async recordEvent(serviceId: string, event: UiServiceEvent): Promise<void> {
		this.changes?.publish({ serviceId, event });
		try {
			await this.events.append(serviceId, event);
			this.changes?.publish({ serviceId });
		} catch (error) {
			this.log.error(
				{ event: "service-events.append-failed", serviceId, err: error },
				"Cannot append service event; check platform event history and directory permissions",
			);
		}
	}
}
