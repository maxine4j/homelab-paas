import type { ServiceDescriptor, WebResource, WorkerResource, UiServiceEvent } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IChangeBus } from "../events/change-bus.ts";
import type { IGitService } from "../git/git-service.ts";
import type { GitFileSource } from "../git/types.ts";
import { createLogger } from "../util/logger.ts";
import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";
import type { IEnvironmentResolver } from "./environment-resolver.ts";
import { EnvironmentResolutionError } from "./environment-resolver.ts";
import type { IWebResourceReconciler } from "./resources/web/web-reconciler.ts";
import type { IWorkerResourceReconciler } from "./resources/worker/worker-reconciler.ts";
import type { IServiceEventStore } from "./service-event-store.ts";
import { serviceEventMessages } from "./types.ts";
import type { DescriptorDecoder, IReconcilerService, IReconciliationStateStore } from "./types.ts";

export class ReconcilerService implements IReconcilerService {
	private readonly log = createLogger(ReconcilerService.name);
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly web: IWebResourceReconciler,
		private readonly state: IReconciliationStateStore,
		private readonly now: () => number,
		private readonly environment: IEnvironmentResolver,
		private readonly worker: IWorkerResourceReconciler,
		private readonly events: IServiceEventStore,
		private readonly changes?: IChangeBus,
	) {}

	reconcile(): Promise<void> {
		const operation = this.pending.then(async () => {
			for (const [serviceId, source] of Object.entries(this.config.getServices())) {
				try {
					await this.reconcileService(serviceId, source);
				} catch (error) {
					await this.recordEvent(serviceId, {
						timestamp: this.now(),
						level: "error",
						event: "reconciliation.state-failed",
						message: serviceEventMessages.state,
					});
					this.log.error(
						{ event: "reconciliation.state-failed", serviceId, err: error },
						"Cannot persist reconciliation state; check platform state directory access",
					);
				}
			}
		});
		this.pending = operation.catch(() => {});
		return operation;
	}

	private async reconcileService(serviceId: string, source: GitFileSource): Promise<void> {
		const previous = await this.state.read(serviceId);
		if ((previous?.retryAt ?? 0) > this.now()) return;
		let desiredRevision = previous?.desiredRevision;
		let deploymentStartedAt = previous?.deploymentStartedAt;
		let message: string = serviceEventMessages.fetch;
		let resourceId: string | undefined;
		try {
			const file = await this.git.fetchFile(serviceId, source);
			desiredRevision = file.revision;
			if (previous?.desiredRevision !== desiredRevision) deploymentStartedAt = undefined;
			message = serviceEventMessages.descriptor;
			const descriptor = this.decode(file.content, serviceId, file.revision);
			message = serviceEventMessages.capabilities;
			const desired = this.deploymentResources(descriptor);
			message = serviceEventMessages.secrets;
			const resources: [string, DeploymentWebResource | DeploymentWorkerResource][] = [];
			for (const [id, resource] of desired) {
				resourceId = id;
				const env = await this.environment.resolve(serviceId, resource.env ?? []);
				resources.push([id, { ...resource, env }]);
			}
			resourceId = undefined;
			if (previous?.desiredRevision !== desiredRevision)
				this.log.info(
					{ event: "reconciliation.revision", serviceId, revision: desiredRevision },
					"Detected new valid descriptor revision; reconciling resources",
				);
			message = serviceEventMessages.state;
			if (previous?.activeRevision !== desiredRevision) deploymentStartedAt ??= this.now();
			await this.state.write(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase:
					previous?.phase === "ready" && previous.activeRevision === desiredRevision ? "ready" : "deploying",
				deploymentStartedAt,
				failures: previous?.desiredRevision === desiredRevision ? previous.failures : undefined,
				retryAt: previous?.retryAt,
			});
			this.changes?.publish({ serviceId });
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
				if (resource.type === "web") {
					message = serviceEventMessages.web;
					await this.web.reconcile({ serviceId, resourceId: id, revision: desiredRevision, resource });
				} else {
					message = serviceEventMessages.worker;
					await this.worker.reconcile({ serviceId, resourceId: id, revision: desiredRevision, resource });
				}
			}
			resourceId = undefined;
			message = serviceEventMessages.state;
			await this.state.write(serviceId, { desiredRevision, activeRevision: desiredRevision, phase: "ready" });
			this.changes?.publish({ serviceId });
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
		} catch (error) {
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
				message,
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
			await this.state.write(serviceId, {
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
			this.changes?.publish({ serviceId });
		}
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

	private deploymentResources(descriptor: ServiceDescriptor): [string, WebResource | WorkerResource][] {
		const entries = Object.entries(descriptor.resources);
		const webCount = entries.filter(([, resource]) => resource.type === "web").length;
		if (entries.length === 0) throw new Error("Runtime requires at least one workload resource");
		return entries.map(([resourceId, resource]) => {
			if (
				(resource.type !== "web" && resource.type !== "worker")
				|| (resource.type === "web"
					&& ((!this.config.getAuthConfig() && resource.ingress.public !== true)
						|| (resource.replicas ?? 1) !== 1))
				|| resource.egress !== undefined
			)
				throw new Error("Resource requires unsupported runtime capabilities");
			return [
				resourceId,
				resource.type === "web"
					? { ...resource, primary: webCount === 1 || resource.primary === true }
					: resource,
			];
		});
	}
}
