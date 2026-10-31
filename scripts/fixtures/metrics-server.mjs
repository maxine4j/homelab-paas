import Koa from "koa";

import { createMetricsRouter } from "./dist/metrics/metrics-router.js";
import { MetricsService } from "./dist/metrics/metrics-service.js";

const metrics = new MetricsService("fixture", process.env.BUILD_SHA, async () => [
	{
		serviceId: "demo",
		activeRevision: "abcdef012345",
		desiredRevision: "abcdef012345",
		health: "Healthy",
		sync: "Synced",
	},
]);
metrics.request("GET", 200, 0.1);
metrics.reconciliation("demo", "abcdef012345", "success", 0.2);
new Koa().use(createMetricsRouter(metrics).routes()).listen(9090, "0.0.0.0");
