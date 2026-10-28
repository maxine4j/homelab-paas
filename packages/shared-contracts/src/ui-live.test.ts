import { expect, test } from "vitest";

import { uiLiveClientSchema, uiLiveServerSchema, uiLiveTargetFromPath } from "./ui-live.ts";

test("live protocol restricts subscription targets, identities and safe server envelope", () => {
	expect(uiLiveTargetFromPath("/services/demo/resources/app/containers/c/logs")).toEqual({
		kind: "logs",
		serviceId: "demo",
		resourceId: "app",
		containerId: "c",
	});
	expect(uiLiveTargetFromPath("/not-an-api")).toBeUndefined();
	expect(uiLiveClientSchema.safeParse({ type: "subscribe", id: "1", target: { kind: "services" } }).success).toBe(
		true,
	);
	expect(
		uiLiveClientSchema.safeParse({ type: "subscribe", id: "1", target: { kind: "service", serviceId: "../evil" } })
			.success,
	).toBe(false);
	expect(
		uiLiveServerSchema.safeParse({
			type: "snapshot",
			id: "1",
			target: { kind: "services" },
			data: [{ phase: "secret" }],
		}).success,
	).toBe(false);
	expect(uiLiveServerSchema.safeParse({ type: "error", id: "1", message: "raw secret" }).success).toBe(false);
});
