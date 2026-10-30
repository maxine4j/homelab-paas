import { expect, test, vi } from "vitest";

import { DeploymentService } from "./deployment-service.ts";
import type { DeploymentRequest, DeploymentStrategy } from "./strategy/types.ts";

const request: DeploymentRequest = {
	serviceId: "demo",
	resourceId: "app",
	revision: "rev",
	spec: "spec",
	resource: { type: "web", image: "app:1", ingress: { public: true, port: 8080 } },
};

test("failed rollouts clear deploying health while preserving the deployment failure", async () => {
	const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
	const service = new DeploymentService(
		[
			{
				name: "recreate",
				deploy: async () => {
					throw new Error("rollout failed");
				},
			},
		],
		progress,
	);
	await expect(service.deploy(request)).rejects.toThrow("rollout failed");
	expect(progress.failed).toHaveBeenCalledWith("demo", "app", "rev");
	expect(progress.succeeded).not.toHaveBeenCalled();
});

test("selects recreate for omitted or explicit rollout strategy", async () => {
	const calls: DeploymentRequest[] = [];
	const recreate: DeploymentStrategy = {
		name: "recreate",
		async deploy(input) {
			calls.push(input);
		},
	};
	const service = new DeploymentService([recreate]);
	await service.deploy(request);
	await service.deploy({ ...request, resource: { ...request.resource, rolloutStrategy: "recreate" } });
	expect(calls).toEqual([request, { ...request, resource: { ...request.resource, rolloutStrategy: "recreate" } }]);
});

test("a missing strategy fails before running a deployment", async () => {
	await expect(new DeploymentService([]).deploy(request)).rejects.toThrow("Deployment strategy is not available");
});

test("selects the registered surge strategy from the resource descriptor", async () => {
	const calls: DeploymentRequest[] = [];
	const service = new DeploymentService([
		{
			name: "recreate",
			async deploy() {
				throw new Error("Wrong strategy selected");
			},
		},
		{
			name: "surge",
			async deploy(input) {
				calls.push(input);
			},
		},
	]);
	const surge: DeploymentRequest = { ...request, resource: { ...request.resource, rolloutStrategy: "surge" } };
	await service.deploy(surge);
	expect(calls).toEqual([surge]);
});

test("rejects ambiguous strategy registration", () => {
	const strategy: DeploymentStrategy = { name: "recreate", async deploy() {} };
	expect(() => new DeploymentService([strategy, strategy])).toThrow("Duplicate deployment strategy");
});

test("propagates strategy failures without retrying", async () => {
	let attempts = 0;
	const strategy: DeploymentStrategy = {
		name: "recreate",
		async deploy() {
			attempts++;
			throw new Error("failed");
		},
	};
	await expect(new DeploymentService([strategy]).deploy(request)).rejects.toThrow("failed");
	expect(attempts).toBe(1);
});
