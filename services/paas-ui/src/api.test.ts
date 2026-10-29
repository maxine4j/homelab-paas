import { expect, test, vi } from "vitest";

import { fetchUi, saveConfig, refreshGit } from "./api.ts";

test("Git refresh failures direct users to reload the page to check whether work completed", async () => {
	await expect(
		refreshGit(undefined, new AbortController().signal, async () => new Response(null, { status: 503 })),
	).rejects.toThrow("The request may have completed; reload the page to check.");
});

test("Git refresh posts explicit intent for all or one service, preserves partial results and cancellation", async () => {
	const results = [
		{ serviceId: "demo", refreshed: true },
		{ serviceId: "broken", refreshed: false },
	];
	const request = vi.fn<typeof fetch>(async () => Response.json({ results }));
	const controller = new AbortController();
	expect(await refreshGit(undefined, controller.signal, request)).toEqual({ results });
	expect(request).toHaveBeenLastCalledWith(
		"/api/ui/services/refresh",
		expect.objectContaining({ method: "POST", credentials: "same-origin", headers: { "x-paas-refresh": "1" } }),
	);
	await refreshGit("demo", controller.signal, request);
	expect(request.mock.calls.at(-1)?.at(0)).toBe("/api/ui/services/demo/refresh");
	controller.abort();
	expect(request.mock.calls.at(-1)?.at(1)).toMatchObject({ signal: expect.objectContaining({ aborted: true }) });
	for (const [status, message] of [
		[401, "session"],
		[404, "not configured"],
		[503, "Cannot refresh"],
	] as const) {
		await expect(
			refreshGit("demo", new AbortController().signal, async () => new Response("secret-canary", { status })),
		).rejects.toThrow(message);
	}
});

test("configuration saves send only edits and distinguish conflicts from validation failures", async () => {
	const update = { revision: "r1", changes: [{ path: "git.pollIntervalSeconds", value: 9 }] };
	const snapshot = { config: {}, revision: "r2", fields: [] };
	const request = vi.fn(async () => Response.json(snapshot));
	expect(await saveConfig(update, new AbortController().signal, request)).toEqual(snapshot);
	expect(request).toHaveBeenCalledWith(
		"/api/ui/cluster/config",
		expect.objectContaining({
			method: "PUT",
			credentials: "same-origin",
			headers: { "content-type": "application/json", "x-paas-config": "1" },
			body: JSON.stringify(update),
		}),
	);
	for (const [status, message] of [
		[409, "Configuration changed"],
		[400, "Invalid configuration"],
		[401, "A platform session is required"],
		[503, "Cannot save configuration"],
	] as const) {
		await expect(
			saveConfig(update, new AbortController().signal, async () => new Response("private-secret", { status })),
		).rejects.toThrow(message);
	}
});

test("fetches private snapshots with cancellation and preserves auth errors", async () => {
	const request = vi.fn(async () => new Response(JSON.stringify({ clusterId: "local" })));
	const controller = new AbortController();
	expect(await fetchUi("/cluster", controller.signal, request)).toEqual({ clusterId: "local" });
	expect(request).toHaveBeenCalledWith(
		"/api/ui/cluster",
		expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }),
	);
	await expect(
		fetchUi("/cluster", controller.signal, async () => new Response("secret-canary", { status: 401 })),
	).rejects.toThrow("A platform session is required");
	await expect(
		fetchUi("/cluster", controller.signal, async () => new Response("secret-canary", { status: 503 })),
	).rejects.toThrow("Cluster data is unavailable");
});
