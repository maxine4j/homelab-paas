import { expect, test } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { DeploymentProgress } from "./deployment-progress.ts";
import type { ReconciliationState } from "./types.ts";

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
