import type { ServiceDescriptor, WebResource } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IGitService } from "../git/git-service.ts";
import type { GitFileSource } from "../git/types.ts";
import { createLogger } from "../util/logger.ts";
import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { IEnvironmentResolver } from "./environment-resolver.ts";
import type { IWebResourceReconciler } from "./resources/web/web-reconciler.ts";
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
			message = "Invalid descriptor; check service identity and supported web resource fields";
			const descriptor = this.decode(file.content, serviceId);
			message =
				"Unsupported descriptor capabilities; runtime requires one web resource, one replica, recreate or surge deployment and configured auth/TLS for private ingress";
			const desired = this.deploymentResources(descriptor);
			message = "Cannot resolve application secrets; check the service env file and required variable names";
			const resources: [string, DeploymentWebResource][] = [];
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
			message = "Cannot reconcile web resource; check Docker, image, readiness and Envoy access";
			for (const [resourceId, resource] of resources) {
				await this.web.reconcile({ serviceId, resourceId, revision: desiredRevision, resource });
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

	private deploymentResources(descriptor: ServiceDescriptor): [string, WebResource][] {
		const entries = Object.entries(descriptor.resources);
		if (entries.length !== 1) throw new Error("Runtime requires exactly one web resource");
		return entries.map(([resourceId, resource]) => {
			if (
				resource.type !== "web"
				|| (!this.config.getAuthConfig() && resource.ingress.public !== true)
				|| (resource.replicas ?? 1) !== 1
				|| resource.egress !== undefined
			)
				throw new Error("Resource requires unsupported runtime capabilities");
			return [resourceId, resource];
		});
	}
}
