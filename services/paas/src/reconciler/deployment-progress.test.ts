import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { DeploymentProgress } from "./deployment-progress.ts";
import type { ReconciliationState } from "./types.ts";

test("new-revision resources emit durable and immediate markers even when the whole rollout falls between health polls", async () => {
	const append = vi.fn();
	const write = vi.fn();
	const changes = new ChangeBus();
	const received = vi.fn();
	changes.subscribe(received);
	const progress = new DeploymentProgress(
		{ read: async () => ({ phase: "deploying", desiredRevision: "new" }), write },
		{ append, list: async () => [] },
		changes,
		() => 100,
	);
	await progress.started("demo", "app", "new");
	await progress.started("demo", "app", "new");
	await progress.succeeded("demo", "app", "new");
	expect(append.mock.calls.map((call) => call[1])).toMatchObject([
		{ event: "deployment.started", resourceId: "app", revision: "new" },
		{ event: "deployment.succeeded", resourceId: "app", revision: "new" },
	]);
	expect(received).toHaveBeenCalledWith(
		expect.objectContaining({
			serviceId: "demo",
			event: expect.objectContaining({ event: "deployment.started", resourceId: "app" }),
		}),
	);
	expect(write).not.toHaveBeenCalled();
});

test("tracks resource rollout health for new revisions and clears it on success or failure", async () => {
	const health = { started: vi.fn(), finished: vi.fn() };
	const progress = new DeploymentProgress(
		{ read: async () => undefined, write: async () => {} },
		{ append: async () => {}, list: async () => [] },
		new ChangeBus(),
		() => 100,
		health,
	);
	await progress.started("demo", "app", "new");
	expect(health.started).toHaveBeenCalledWith("demo", "app");
	await progress.succeeded("demo", "app", "new");
	expect(health.finished).toHaveBeenCalledWith("demo", "app");
	await progress.started("demo", "worker", "new");
	await progress.failed("demo", "worker", "new");
	expect(health.finished).toHaveBeenCalledWith("demo", "worker");
});

test("actual same-revision drift enters deploying, reports completion and suppresses retry starts", async () => {
	let state: ReconciliationState = { phase: "ready", activeRevision: "rev", desiredRevision: "rev" };
	const events: unknown[] = [];
	const progress = new DeploymentProgress(
		{
			read: async () => state,
			write: async (_id, next) => {
				state = next;
			},
		},
		{
			append: async (_id, event) => {
				events.push(event);
			},
			list: async () => [],
		},
		new ChangeBus(),
		() => 100,
	);
	await progress.started("demo", "app", "rev");
	expect(state.phase).toBe("deploying");
	await progress.started("demo", "app", "rev");
	expect(events).toHaveLength(1);
	await progress.succeeded("demo", "app", "rev");
	expect(events).toMatchObject([{ event: "deployment.started" }, { event: "deployment.succeeded" }]);
});

test("deployment completion refreshes targeted independent observations after invalidating rollout health", async () => {
	const order: string[] = [];
	const refresh = vi.fn(async (serviceId: string) => {
		order.push(serviceId);
	});
	const progress = new DeploymentProgress(
		{ read: async () => undefined, write: async () => {} },
		{ append: async () => {}, list: async () => [] },
		new ChangeBus(),
		() => 0,
		{
			started: () => {},
			finished: () => {
				order.push("finished");
			},
		},
		refresh,
	);
	await progress.succeeded("demo", "app", "rev");
	await progress.failed("demo", "app", "rev");
	expect(order).toEqual(["finished", "demo", "finished", "demo"]);
});

test("observation failure cannot fail successful rollout or mask its original deployment error", async () => {
	const progress = new DeploymentProgress(
		{ read: async () => undefined, write: async () => {} },
		{ append: async () => {}, list: async () => [] },
		new ChangeBus(),
		() => 0,
		undefined,
		async () => {
			throw new Error("management unavailable");
		},
	);
	await expect(progress.succeeded("demo", "app", "rev")).resolves.toBeUndefined();
	await expect(progress.failed("demo", "app", "rev")).resolves.toBeUndefined();
});
