import type { ServiceDescriptor, WebResource, WorkerResource } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IGitService } from "../git/git-service.ts";
import type { GitFileSource } from "../git/types.ts";
import { createLogger } from "../util/logger.ts";
import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";
import type { IEnvironmentResolver } from "./environment-resolver.ts";
import type { IWebResourceReconciler } from "./resources/web/web-reconciler.ts";
import type { IWorkerResourceReconciler } from "./resources/worker/worker-reconciler.ts";
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
	) {}

	reconcile(): Promise<void> {
		const operation = this.pending.then(async () => {
			for (const [serviceId, source] of Object.entries(this.config.getServices())) {
				try {
					await this.reconcileService(serviceId, source);
				} catch (error) {
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
		let message = "Cannot fetch descriptor; check repository, branch and committed file path";
		try {
			const file = await this.git.fetchFile(serviceId, source);
			desiredRevision = file.revision;
			message = "Invalid descriptor; check service identity and supported resource fields";
			const descriptor = this.decode(file.content, serviceId);
			message =
				"Unsupported descriptor capabilities; runtime supports workers and single-replica web resources, without egress; private ingress requires auth/TLS";
			const desired = this.deploymentResources(descriptor);
			message = "Cannot resolve application secrets; check the service env file and required variable names";
			const resources: [string, DeploymentWebResource | DeploymentWorkerResource][] = [];
			for (const [resourceId, resource] of desired) {
				const env = await this.environment.resolve(serviceId, resource.env ?? []);
				resources.push([resourceId, { ...resource, env }]);
			}
			if (previous?.desiredRevision !== desiredRevision)
				this.log.info(
					{ event: "reconciliation.revision", serviceId, revision: desiredRevision },
					"Detected new valid descriptor revision; reconciling resources",
				);
			await this.state.write(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase: "deploying",
			});
			for (const [resourceId, resource] of resources) {
				if (resource.type === "web") {
					message = "Cannot reconcile web resource; check Docker, image, readiness and Envoy access";
					await this.web.reconcile({ serviceId, resourceId, revision: desiredRevision, resource });
				} else {
					message = "Cannot reconcile worker resource; check Docker, image and private health check";
					await this.worker.reconcile({ serviceId, resourceId, revision: desiredRevision, resource });
				}
			}
			await this.state.write(serviceId, { desiredRevision, activeRevision: desiredRevision, phase: "ready" });
			if (previous?.phase === "failed")
				this.log.info(
					{ event: "reconciliation.recovered", serviceId, revision: desiredRevision },
					"Service recovered; clearing retry backoff",
				);
		} catch (error) {
			const retry = this.config.getReconciliationConfig();
			const failures = Math.min((previous?.failures ?? 0) + 1, 1024);
			const delay =
				Math.min(
					retry.maxRetryBackoffSeconds,
					this.config.getReconciliationConfig().retryBackoffSeconds * 2 ** (failures - 1),
				) * 1000;
			const retryAt = this.now() + delay;
			await this.state.write(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase: "failed",
				error: message,
				failures,
				retryAt,
			});
			this.log.error(
				{ event: "reconciliation.failed", serviceId, failures, retryAt, err: error },
				`${message}; retry scheduled`,
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
