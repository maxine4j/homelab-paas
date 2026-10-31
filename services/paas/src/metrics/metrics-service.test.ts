import { expect, test } from "vitest";

import { MetricsService } from "./metrics-service.ts";

test("exports labelled request and reconciliation counters and duration sums", async () => {
	const metrics = new MetricsService("local", "abcdef012345", async () => []);
	metrics.request("GET", 200, 0.25);
	metrics.request("GET", 200, 0.5);
	metrics.reconciliation("demo", "1234567890", "success", 2);
	metrics.reconciliation("demo", undefined, "failure", 3);
	const output = await metrics.render();
	expect(output).toContain("# TYPE paas_http_request_duration_seconds histogram");
	expect(output).toMatch(/paas_http_request_duration_seconds_bucket\{[^\n]*le="0.5"[^\n]*\} 2/);
	expect(output).toContain(
		'paas_http_requests_total{cluster="local",serviceId="paas",revision="abcdef0",method="GET",status="200"} 2',
	);
	expect(output).toContain(
		'paas_http_request_duration_seconds_sum{cluster="local",serviceId="paas",revision="abcdef0",method="GET",status="200"} 0.75',
	);
	expect(output).toContain('serviceId="demo",revision="1234567",outcome="success"} 1');
	expect(output).toContain('serviceId="demo",revision="unknown",outcome="failure"} 1');
});

test("exports current health/sync and removes obsolete snapshots, escaping label values", async () => {
	let services = [
		{
			serviceId: 'demo"\\\n',
			activeRevision: "abcdef0123",
			desiredRevision: "1234567890",
			health: "Degraded" as const,
			sync: "OutOfSync" as const,
		},
	];
	const metrics = new MetricsService("local", "unknown", async () => services);
	const output = await metrics.render();
	expect(output).toContain(
		'paas_service_health{cluster="local",serviceId="demo\\\"\\\\\\n",revision="abcdef0",health="Degraded"} 1',
	);
	expect(output).toContain('revision="1234567",sync="OutOfSync"} 1');
	services = [];
	expect(await metrics.render()).not.toContain("paas_service_health{");
});

test("bounds retained revision series and normalizes non-SHA revisions", async () => {
	const metrics = new MetricsService("local", "invalid", async () => []);
	for (let i = 0; i < 2100; i++)
		metrics.reconciliation("demo", i.toString(16).padStart(7, "0").padEnd(40, "0"), "success", 1);
	const output = await metrics.render();
	expect(output.split("\n").filter((line) => line.startsWith("paas_reconciliations_total{"))).toHaveLength(2048);
	metrics.request("CUSTOM", 200, 0.1);
	expect(await metrics.render()).toContain('revision="unknown",method="OTHER"');
});
