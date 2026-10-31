import { expect, test, vi } from "vitest";

import { fetchUi, saveConfig, refreshGit, redeployService, saveSecrets } from "./api.ts";

test("redeploy sends same-origin intent, cancellation and safe errors", async () => {
	const signal = new AbortController().signal;
	const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
	await redeployService("demo/a", signal, request);
	expect(request).toHaveBeenCalledWith(
		"/api/ui/services/demo%2Fa/redeploy",
		expect.objectContaining({
			method: "POST",
			credentials: "same-origin",
			headers: { "x-paas-redeploy": "1" },
			signal,
		}),
	);
	for (const [status, message] of [
		[401, "session"],
		[404, "not configured"],
		[503, "Cannot redeploy"],
	] as const)
		await expect(
			redeployService("demo", signal, async () => new Response("secret-canary", { status })),
		).rejects.toThrow(message);
});

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
test("secret saves send only selected write-only edits and provide safe conflict/validation messages", async () => {
	const update = { revision: "r1", changes: [{ name: "EMPTY", value: "" }] };
	const request = vi.fn(async () => new Response(JSON.stringify({ revision: "r2", variables: [] })));
	expect(await saveSecrets("demo", update, new AbortController().signal, request)).toEqual({
		revision: "r2",
		variables: [],
	});
	expect(request).toHaveBeenCalledWith(
		"/api/ui/services/demo/secrets",
		expect.objectContaining({
			method: "PUT",
			credentials: "same-origin",
			cache: "no-store",
			headers: { "content-type": "application/json", "x-paas-secrets": "1" },
			body: JSON.stringify(update),
		}),
	);
	for (const [status, message] of [
		[409, "Secrets changed"],
		[400, "single-line"],
		[401, "session"],
		[503, "Cannot save secrets"],
	] as const) {
		await expect(
			saveSecrets(
				"demo",
				update,
				new AbortController().signal,
				async () => new Response("private-secret", { status }),
			),
		).rejects.toThrow(message);
	}
});
