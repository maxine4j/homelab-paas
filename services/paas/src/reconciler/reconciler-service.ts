import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import type { IGitService } from "../git/git-service.ts";
import type { GitFileSource } from "../git/types.ts";
import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { IWebResourceReconciler } from "./resources/web/web-reconciler.ts";
import type { DescriptorDecoder, IReconcilerService, IReconciliationStateStore } from "./types.ts";

export class ReconcilerService implements IReconcilerService {
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly services: Readonly<Record<string, GitFileSource>>,
		private readonly retry: { retryBackoffSeconds: number; maxRetryBackoffSeconds: number },
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly web: IWebResourceReconciler,
		private readonly state: IReconciliationStateStore,
		private readonly now: () => number,
		private readonly report: (serviceId: string, message: string) => void,
		private readonly privateIngressEnabled = false,
	) {}

	reconcile(): Promise<void> {
		const operation = this.pending.then(async () => {
			for (const [serviceId, source] of Object.entries(this.services)) {
				try {
					await this.reconcileService(serviceId, source);
				} catch {
					this.report(
						serviceId,
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
				"Unsupported descriptor capabilities; runtime requires one web resource, one replica, recreate deployment and configured auth/TLS for private ingress";
			const resources = this.deploymentResources(descriptor);
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
		} catch {
			const failures = Math.min((previous?.failures ?? 0) + 1, 1024);
			const delay =
				Math.min(this.retry.maxRetryBackoffSeconds, this.retry.retryBackoffSeconds * 2 ** (failures - 1))
				* 1000;
			await this.state.write(serviceId, {
				desiredRevision,
				activeRevision: previous?.activeRevision,
				phase: "failed",
				error: message,
				failures,
				retryAt: this.now() + delay,
			});
			this.report(serviceId, message);
		}
	}

	private deploymentResources(descriptor: ServiceDescriptor): [string, DeploymentWebResource][] {
		const entries = Object.entries(descriptor.resources);
		if (entries.length !== 1) throw new Error("Runtime requires exactly one web resource");
		return entries.map(([resourceId, resource]) => {
			if (
				resource.type !== "web"
				|| (!this.privateIngressEnabled && resource.ingress.public !== true)
				|| (resource.replicas ?? 1) !== 1
				|| (resource.rolloutStrategy ?? "recreate") !== "recreate"
				|| resource.volumes !== undefined
				|| resource.limits !== undefined
				|| resource.egress !== undefined
			)
				throw new Error("Resource requires unsupported runtime capabilities");
			const env = resource.env?.map((entry) => {
				if (!("value" in entry)) throw new Error("Runtime does not support secret references");
				return entry;
			});
			return [resourceId, { ...resource, env }];
		});
	}
}
