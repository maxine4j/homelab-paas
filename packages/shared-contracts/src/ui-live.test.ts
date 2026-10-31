import { expect, test } from "vitest";

import { uiLiveClientSchema, uiLiveServerSchema, uiLiveTargetFromPath } from "./ui-live.ts";

test("cluster logs use a fixed target and bounded log snapshots", () => {
	expect(uiLiveTargetFromPath("/cluster/logs")).toEqual({ kind: "cluster-logs" });
	const message = {
		type: "snapshot",
		id: "1",
		target: { kind: "cluster-logs" },
		data: { containerId: "control", content: "ready", tail: 200 },
	};
	expect(uiLiveServerSchema.safeParse(message).success).toBe(true);
	expect(
		uiLiveServerSchema.safeParse({ ...message, data: { ...message.data, content: "x".repeat(131073) } }).success,
	).toBe(false);
	expect(
		uiLiveClientSchema.safeParse({
			type: "subscribe",
			id: "1",
			target: { kind: "cluster-logs", containerId: "arbitrary" },
		}).success,
	).toBe(false);
});

test("resource snapshots require independent Argo sync and health states", () => {
	const snapshot = (health: unknown) => ({
		type: "snapshot",
		id: "1",
		target: { kind: "resource", serviceId: "demo", resourceId: "app" },
		data: { resourceId: "app", type: "web", sync: "Synced", health, containers: [] },
	});
	for (const health of ["Healthy", "Progressing", "Degraded", "Missing", "Unknown"]) {
		expect(uiLiveServerSchema.parse(snapshot(health))).toMatchObject({ data: { health } });
	}
	for (const health of [undefined, "running", "mixed", "Suspended", "deploying", "unhealthy"])
		expect(uiLiveServerSchema.safeParse(snapshot(health)).success).toBe(false);
	for (const sync of ["Synced", "OutOfSync", "Unknown"])
		expect(
			uiLiveServerSchema.safeParse({ ...snapshot("Healthy"), data: { ...snapshot("Healthy").data, sync } })
				.success,
		).toBe(true);
	for (const sync of [undefined, "Syncing", "Failed"])
		expect(
			uiLiveServerSchema.safeParse({ ...snapshot("Healthy"), data: { ...snapshot("Healthy").data, sync } })
				.success,
		).toBe(false);
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

test("event notifications retain bounded diagnostic text and reject oversized UTF-8 output", () => {
	const notification = (diagnostics: string) => ({
		type: "event",
		serviceId: "demo",
		event: {
			timestamp: 1,
			level: "error",
			event: "reconciliation.failed",
			message: "Deployment failed",
			diagnostics,
		},
	});
	const diagnostics = "Docker POST /containers/create: HTTP 500\n at start";
	expect(uiLiveServerSchema.parse(notification(diagnostics))).toMatchObject({ event: { diagnostics } });
	expect(uiLiveServerSchema.safeParse(notification("x".repeat(32769))).success).toBe(false);
	expect(uiLiveServerSchema.safeParse(notification("雪".repeat(16000))).success).toBe(false);
});
