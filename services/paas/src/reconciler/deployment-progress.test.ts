import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { DeploymentProgress } from "./deployment-progress.ts";
import type { ReconciliationState } from "./types.ts";

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
