import { expect, test, vi } from "vitest";

import { DeploymentService } from "./deployment-service.ts";
import type { DeploymentStrategy } from "./strategy/types.ts";
import type { DeploymentRequest, WorkerDeploymentRequest } from "./types.ts";

const request: DeploymentRequest = {
	serviceId: "demo",
	resourceId: "app",
	revision: "rev",
	spec: "spec",
	resource: { type: "web", image: "app:1", ingress: { public: true, port: 8080 } },
};

test.each([undefined, "recreate", "surge"] as const)(
	"dispatches web and worker rollouts independently for %s",
	async (rolloutStrategy) => {
		const webDeploy = vi.fn(async () => {});
		const workerDeploy = vi.fn(async () => {});
		const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
		const name = rolloutStrategy ?? "recreate";
		const service = new DeploymentService(
			[
				{ resourceType: "web", name, deploy: webDeploy },
				{ resourceType: "worker", name, deploy: workerDeploy },
			],
			progress,
		);
		const web = { ...request, resource: { ...request.resource, rolloutStrategy } };
		const worker: WorkerDeploymentRequest = {
			...request,
			force: true,
			resource: { type: "worker", image: "jobs:1", healthcheckPort: 9090, rolloutStrategy },
		};
		await service.deploy(web);
		await service.deploy(worker);
		expect(webDeploy.mock.calls).toEqual([[web]]);
		expect(workerDeploy.mock.calls).toEqual([[worker]]);
		expect(progress.started).toHaveBeenCalledTimes(2);
		expect(progress.succeeded).toHaveBeenCalledTimes(2);
		expect(progress.failed).not.toHaveBeenCalled();
	},
);

test("does not run a web strategy for a worker or report deployment progress", async () => {
	const deploy = vi.fn(async () => {});
	const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
	const service = new DeploymentService([{ resourceType: "web", name: "recreate", deploy }], progress);
	await expect(
		service.deploy({
			...request,
			resource: { type: "worker", image: "jobs:1", healthcheckPort: 9090 },
		}),
	).rejects.toThrow("Deployment strategy is not available");
	expect(deploy).not.toHaveBeenCalled();
	expect(progress.started).not.toHaveBeenCalled();
});

test("worker rollout failures clear progress and propagate without retrying", async () => {
	const failure = new Error("worker rollout failed");
	const deploy = vi.fn(async () => {
		throw failure;
	});
	const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
	const service = new DeploymentService([{ resourceType: "worker", name: "surge", deploy }], progress);
	await expect(
		service.deploy({
			...request,
			resource: { type: "worker", image: "jobs:1", healthcheckPort: 9090, rolloutStrategy: "surge" },
		}),
	).rejects.toBe(failure);
	expect(deploy).toHaveBeenCalledTimes(1);
	expect(progress.started).toHaveBeenCalledWith("demo", "app", "rev");
	expect(progress.failed).toHaveBeenCalledWith("demo", "app", "rev");
	expect(progress.succeeded).not.toHaveBeenCalled();
});

test("failed rollouts clear deploying health while preserving the deployment failure", async () => {
	const progress = { started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
	const service = new DeploymentService(
		[
			{
				resourceType: "web",
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
		resourceType: "web",
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
			resourceType: "web",
			name: "recreate",
			async deploy() {
				throw new Error("Wrong strategy selected");
			},
		},
		{
			resourceType: "web",
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
	const strategy: DeploymentStrategy = { resourceType: "web", name: "recreate", async deploy() {} };
	expect(() => new DeploymentService([strategy, strategy])).toThrow("Duplicate deployment strategy");
});

test("propagates strategy failures without retrying", async () => {
	let attempts = 0;
	const strategy: DeploymentStrategy = {
		resourceType: "web",
		name: "recreate",
		async deploy() {
			attempts++;
			throw new Error("failed");
		},
	};
	await expect(new DeploymentService([strategy]).deploy(request)).rejects.toThrow("failed");
	expect(attempts).toBe(1);
});
