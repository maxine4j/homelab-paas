import { createHash } from "node:crypto";

import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import type { PlatformConfig } from "./config.ts";
import {
	DeploymentError,
	type DescriptorSource,
	type DeploymentStatus,
	type RouteStore,
	type StateStore,
	type WorkloadClient,
} from "./contracts.ts";

export class Reconciler {
	private pending: Promise<void> = Promise.resolve();
	private readonly retries = new Map<string, { failures: number; after: number }>();
	private readonly statuses = new Map<string, DeploymentStatus>();
	constructor(
		private readonly deps: {
			config: PlatformConfig;
			source: DescriptorSource;
			workloads: WorkloadClient;
			routes: RouteStore;
			state: StateStore;
			decode: (content: string, serviceId: string) => ServiceDescriptor;
			now: () => number;
			report: (serviceId: string, message: string) => void;
		},
	) {}
	run(): Promise<void> {
		const next = this.pending.then(() => this.reconcile());
		this.pending = next.catch(() => {});
		return next;
	}
	private async checkpoint(serviceId: string, status: DeploymentStatus): Promise<void> {
		await this.deps.state.write(serviceId, status);
		this.statuses.set(serviceId, status);
	}
	private async reconcile(): Promise<void> {
		for (const [serviceId, source] of Object.entries(this.deps.config.services)) {
			if ((this.retries.get(serviceId)?.after ?? 0) > this.deps.now()) continue;
			try {
				const { revision, content } = await this.deps.source.read(serviceId, source);
				const descriptor = this.deps.decode(content, serviceId);
				const entry = Object.entries(descriptor.resources).at(0);
				if (!entry) throw new DeploymentError("Invalid service descriptor");
				const [resourceId, resource] = entry;
				const spec = createHash("sha256")
					.update(JSON.stringify([resourceId, resource]))
					.digest("hex");
				await this.deps.workloads.prepareNetwork(serviceId);
				const containers = await this.deps.workloads.list(serviceId);
				let current = containers.find(
					(container) => container.spec === spec && container.resourceId === resourceId,
				);
				await this.checkpoint(serviceId, {
					desiredRevision: revision,
					activeRevision: current?.revision,
					phase: "deploying",
				});
				if (!current) {
					// Resolve before stopping the working revision; image failures leave it intact.
					const imageId = await this.deps.workloads.resolveImage(resource.image);
					await this.deps.routes.set(serviceId, undefined);
					for (const container of containers) {
						await this.deps.workloads.stop(container.id, resource.termination?.timeoutSeconds ?? 30);
						await this.deps.workloads.remove(container.id);
					}
					const id = await this.deps.workloads.create(
						serviceId,
						resourceId,
						revision,
						spec,
						resource,
						imageId,
					);
					current = { id, resourceId, spec, revision, running: false };
				}
				if (!current.running) await this.deps.workloads.start(current.id);
				let endpoint;
				try {
					endpoint = await this.deps.workloads.waitReady(current.id, resource);
				} catch (error) {
					await this.deps.routes.set(serviceId, undefined);
					throw error;
				}
				await this.deps.routes.set(serviceId, endpoint);
				await this.checkpoint(serviceId, {
					desiredRevision: revision,
					activeRevision: current.revision,
					phase: "ready",
				});
				this.retries.delete(serviceId);
			} catch (error) {
				const message =
					error instanceof DeploymentError
						? error.message
						: "Service reconciliation failed; check descriptor and platform configuration";
				const failures = Math.min((this.retries.get(serviceId)?.failures ?? 0) + 1, 30);
				const retry = this.deps.config.reconciliation;
				this.retries.set(serviceId, {
					failures,
					after:
						this.deps.now()
						+ Math.min(retry.maxRetryBackoffSeconds, retry.retryBackoffSeconds * 2 ** (failures - 1))
							* 1000,
				});
				await this.checkpoint(serviceId, { ...this.statuses.get(serviceId), phase: "failed", error: message });
				this.deps.report(serviceId, message);
			}
		}
	}
}
