import type { UiServiceSummary } from "@homelab-paas/shared-contracts";
import { Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";

import type { ReconciliationOutcome } from "./types.ts";

export interface IReconciliationMetrics {
	reconciliation(
		serviceId: string,
		revision: string | undefined,
		outcome: ReconciliationOutcome,
		seconds: number,
	): void;
}

export interface IMetricsService extends IReconciliationMetrics {
	request(method: string, status: number, seconds: number): void;
	/** Prometheus exposition; snapshot failures propagate so scrapes fail instead of serving stale status. */
	render(): Promise<string>;
}

export class MetricsService implements IMetricsService {
	private readonly registry = new Registry();
	private readonly requests = new Counter({
		name: "paas_http_requests_total",
		help: "Completed control-plane HTTP requests.",
		labelNames: ["cluster", "serviceId", "revision", "method", "status"],
		registers: [this.registry],
	});
	private readonly requestDuration = new Histogram({
		name: "paas_http_request_duration_seconds",
		help: "Control-plane HTTP request duration in seconds.",
		labelNames: ["cluster", "serviceId", "revision", "method", "status"],
		buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
		registers: [this.registry],
	});
	private readonly reconciliations = new Counter({
		name: "paas_reconciliations_total",
		help: "Actual service reconciliation attempts, excluding backoff skips.",
		labelNames: ["cluster", "serviceId", "revision", "outcome"],
		registers: [this.registry],
	});
	private readonly reconciliationDuration = new Histogram({
		name: "paas_reconciliation_duration_seconds",
		help: "Service reconciliation attempt duration in seconds.",
		labelNames: ["cluster", "serviceId", "revision", "outcome"],
		buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
		registers: [this.registry],
	});
	private readonly health = new Gauge({
		name: "paas_service_health",
		help: "Current service health; the current health label has value one.",
		labelNames: ["cluster", "serviceId", "revision", "health"],
		registers: [this.registry],
	});
	private readonly sync = new Gauge({
		name: "paas_service_sync",
		help: "Current service sync; the current sync label has value one.",
		labelNames: ["cluster", "serviceId", "revision", "sync"],
		registers: [this.registry],
	});
	private readonly retainedRequests = new Map<string, Record<string, string>>();
	private readonly retainedReconciliations = new Map<string, Record<string, string>>();

	constructor(
		private readonly cluster: string,
		private readonly revision: string,
		private readonly listServices: () => Promise<UiServiceSummary[]>,
	) {}

	request(method: string, status: number, seconds: number): void {
		const boundedMethod = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)
			? method
			: "OTHER";
		this.observe(
			this.retainedRequests,
			this.requests,
			this.requestDuration,
			this.labels("paas", this.revision, { method: boundedMethod, status: String(status) }),
			seconds,
		);
	}

	reconciliation(
		serviceId: string,
		revision: string | undefined,
		outcome: ReconciliationOutcome,
		seconds: number,
	): void {
		this.observe(
			this.retainedReconciliations,
			this.reconciliations,
			this.reconciliationDuration,
			this.labels(serviceId, revision, { outcome }),
			seconds,
		);
	}

	async render(): Promise<string> {
		const services = await this.listServices();
		this.health.reset();
		this.sync.reset();
		for (const service of services) {
			this.health.set(this.labels(service.serviceId, service.activeRevision, { health: service.health }), 1);
			this.sync.set(this.labels(service.serviceId, service.desiredRevision, { sync: service.sync }), 1);
		}
		return this.registry.metrics();
	}

	private observe(
		retained: Map<string, Record<string, string>>,
		counter: Counter<string>,
		duration: Histogram<string>,
		labels: Record<string, string>,
		seconds: number,
	): void {
		counter.inc(labels);
		duration.observe(labels, Math.max(0, seconds));
		retained.set(JSON.stringify(labels), labels);
		if (retained.size > 2048) {
			const oldest = retained.entries().next().value!;
			counter.remove(oldest[1]);
			duration.remove(oldest[1]);
			retained.delete(oldest[0]);
		}
	}

	private labels(
		serviceId: string,
		revision: string | undefined,
		extra: Record<string, string>,
	): Record<string, string> {
		const short = revision && /^[a-f\d]{7,40}$/i.test(revision) ? revision.slice(0, 7).toLowerCase() : "unknown";
		return { cluster: this.cluster, serviceId, revision: short, ...extra };
	}
}
