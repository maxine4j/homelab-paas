import { expect, test } from "vitest";

import { resourceStatus } from "./resource-status.ts";

test.each([
	[[], "missing"],
	[["running"], "running"],
	[["running", "running"], "running"],
	[["exited"], "exited"],
	[["paused"], "paused"],
	[["restarting"], "restarting"],
	[["running", "exited"], "mixed"],
])("aggregates observed container states %j as %s", (states, expected) => {
	expect(
		resourceStatus({
			resourceId: "web",
			type: "web",
			containers: (states as string[]).map((state) => ({
				id: state,
				resourceId: "web",
				state,
				revision: "rev",
				imageId: "image",
			})),
		}),
	).toBe(expected);
});
