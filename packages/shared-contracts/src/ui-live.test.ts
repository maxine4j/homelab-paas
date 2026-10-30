import { expect, test } from "vitest";

import { uiLiveClientSchema, uiLiveServerSchema, uiLiveTargetFromPath } from "./ui-live.ts";

test("resource snapshots require one of the four health states and retain container state", () => {
	const snapshot = (health: unknown) => ({
		type: "snapshot",
		id: "1",
		target: { kind: "resource", serviceId: "demo", resourceId: "app" },
		data: { resourceId: "app", type: "web", health, containers: [] },
	});
	for (const health of ["deploying", "missing", "healthy", "unhealthy"]) {
		expect(uiLiveServerSchema.parse(snapshot(health))).toMatchObject({ data: { health } });
	}
	for (const health of [undefined, "running", "mixed"])
		expect(uiLiveServerSchema.safeParse(snapshot(health)).success).toBe(false);
});

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
