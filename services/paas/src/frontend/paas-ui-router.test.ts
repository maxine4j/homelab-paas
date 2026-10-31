import Koa from "koa";
import { expect, test, vi } from "vitest";

import { ConfigEditError } from "../config/paas-config.ts";
import { SecretEditError } from "../config/secret-store.ts";
import { GitRefreshError } from "../git/git-refresh-service.ts";
import { RedeployError } from "../reconciler/reconciler-service.ts";
import { captureLogs } from "../util/test/logs.ts";
import { startTestApi } from "../util/test/router.ts";
import { createPaasUiRouter } from "./paas-ui-router.ts";
import { PaasUiError, type IPaasUiService } from "./paas-ui-service.ts";

const fixture = async (authenticated = true) => {
	const calls: unknown[] = [];
	const updateConfig = vi.fn(async (_update: unknown) => ({ config: {}, revision: "saved", fields: [] }));
	const service: IPaasUiService = {
		async getEvents(id) {
			calls.push(id);
			if (id === "missing") throw new PaasUiError("not-found");
			return [
				{
					timestamp: 100,
					level: "error",
					event: "reconciliation.failed",
					message:
						"Cannot resolve application secrets; check the service env file and required variable names",
				},
			];
		},
		updateConfig,
		async getCluster() {
			return { clusterId: "local", config: {}, revision: "r1", fields: [] };
		},
		async listServices() {
			return [];
		},
		async getService(id) {
			calls.push(id);
			throw new PaasUiError(id === "missing" ? "not-found" : "unavailable");
		},
		async getResource(...args) {
			calls.push(args);
			return { resourceId: args[1], type: "web", health: "missing", containers: [] };
		},
		async getLogs(...args) {
			calls.push(args);
			return { containerId: args[2], content: "hello", tail: 200 };
		},
	};
	const verifyAuthCookie = vi.fn(() => (authenticated ? { userId: "owner" } : undefined));
	const refreshOne = vi.fn(async (_id: string) => {});
	const refreshAll = vi.fn(async () => [
		{ serviceId: "demo", refreshed: true },
		{ serviceId: "broken", refreshed: false },
	]);
	const redeploy = vi.fn(async (_id: string) => {});
	const secrets = {
		read: vi.fn(async (_id: string) => ({
			revision: "r1",
			variables: [{ name: "TOKEN", configured: true, used: true }],
		})),
		update: vi.fn(async (_id: string, _update: unknown) => ({ revision: "r2", variables: [] })),
	};
	const router = createPaasUiRouter(
		service,
		{ refreshOne, refreshAll },
		{ verifyAuthCookie },
		undefined,
		{
			redeploy,
		},
		secrets,
	);
	const server = await startTestApi(new Koa().use(router.routes()).use(router.allowedMethods()));
	return { ...server, calls, verifyAuthCookie, updateConfig, refreshOne, refreshAll, redeploy, secrets };
};

test("secret endpoints require authentication, same-origin JSON intent, strict bounded edits and safe errors", async () => {
	const f = await fixture();
	const body = { revision: "r1", changes: [{ name: "TOKEN", value: "private-value" }] };
	const send = (value: unknown = body, headers: Record<string, string> = {}) =>
		fetch(`${f.origin}/api/ui/services/demo/secrets`, {
			method: "PUT",
			headers: { origin: f.origin, "x-paas-secrets": "1", "content-type": "application/json", ...headers },
			body: JSON.stringify(value),
		});
	try {
		const read = await fetch(`${f.origin}/api/ui/services/demo/secrets`);
		expect(read.status).toBe(200);
		expect(read.headers.get("cache-control")).toBe("no-store");
		expect(await read.json()).toMatchObject({ variables: [{ name: "TOKEN", configured: true }] });
		expect((await send()).status).toBe(200);
		expect(f.secrets.update).toHaveBeenCalledWith("demo", body);
		expect((await send(body, { origin: "https://evil.test" })).status).toBe(403);
		expect((await send(body, { "x-paas-secrets": "" })).status).toBe(403);
		expect((await send(body, { "content-type": "text/plain" })).status).toBe(415);
		for (const value of [
			{ ...body, extra: true },
			{ ...body, changes: [{ name: "bad-name", value: "x" }] },
			{ ...body, changes: [] },
		])
			expect((await send(value)).status).toBe(400);
		expect((await send({ ...body, changes: [{ name: "TOKEN", value: "x".repeat(70000) }] })).status).toBe(413);
		for (const [kind, status] of [
			["invalid", 400],
			["conflict", 409],
			["not-found", 404],
			["unavailable", 503],
		] as const) {
			f.secrets.update.mockRejectedValueOnce(new SecretEditError(kind));
			const response = await send();
			expect(response.status).toBe(status);
			expect(await response.text()).not.toContain("private-value");
		}
		f.verifyAuthCookie.mockReturnValue(undefined);
		expect((await send()).status).toBe(401);
		expect((await fetch(`${f.origin}/api/ui/services/demo/secrets`)).status).toBe(401);
	} finally {
		await f.close();
	}
});

test("redeploy requires session and same-origin intent and reports sanitized failures", async () => {
	const f = await fixture();
	const send = (headers: Record<string, string> = {}) =>
		fetch(`${f.origin}/api/ui/services/demo/redeploy`, {
			method: "POST",
			headers: { origin: f.origin, "x-paas-redeploy": "1", ...headers },
		});
	try {
		const response = await send();
		expect(response.status).toBe(204);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(f.redeploy).toHaveBeenCalledWith("demo");
		const rejected: Record<string, string>[] = [
			{ origin: "https://evil.test" },
			{ origin: "" },
			{ "x-paas-redeploy": "" },
		];
		for (const headers of rejected) expect((await send(headers)).status).toBe(403);
		f.verifyAuthCookie.mockReturnValueOnce(undefined);
		expect((await send()).status).toBe(401);
		expect(f.redeploy).toHaveBeenCalledTimes(1);
		for (const [kind, status] of [
			["not-found", 404],
			["unavailable", 503],
		] as const) {
			f.redeploy.mockRejectedValueOnce(new RedeployError(kind, { cause: new Error("secret-canary") }));
			const failed = await send();
			expect(failed.status).toBe(status);
			expect(await failed.text()).not.toContain("secret-canary");
		}
		expect((await fetch(`${f.origin}/api/ui/services/demo/redeploy`)).status).toBe(405);
	} finally {
		await f.close();
	}
});

test("manual Git refresh requires session and same-origin intent, delegates scope and sanitizes failures", async () => {
	const f = await fixture();
	const send = (path = "/services/refresh", headers: Record<string, string> = {}) =>
		fetch(`${f.origin}/api/ui${path}`, {
			method: "POST",
			headers: { origin: f.origin, "x-paas-refresh": "1", ...headers },
		});
	try {
		const all = await send();
		expect(all.status).toBe(200);
		expect(all.headers.get("cache-control")).toBe("no-store");
		expect(await all.json()).toEqual({
			results: [
				{ serviceId: "demo", refreshed: true },
				{ serviceId: "broken", refreshed: false },
			],
		});
		expect(f.refreshAll).toHaveBeenCalledTimes(1);
		expect(await (await send("/services/demo/refresh")).json()).toEqual({
			results: [{ serviceId: "demo", refreshed: true }],
		});
		expect(f.refreshOne).toHaveBeenCalledWith("demo");
		const rejectedHeaders: Record<string, string>[] = [
			{ origin: "https://evil.test" },
			{ origin: "" },
			{ "x-paas-refresh": "" },
		];
		for (const headers of rejectedHeaders) {
			expect((await send(undefined, headers)).status).toBe(403);
		}
		f.verifyAuthCookie.mockReturnValueOnce(undefined);
		expect((await send()).status).toBe(401);
		expect(f.refreshAll).toHaveBeenCalledTimes(1);
		for (const [kind, status] of [
			["not-found", 404],
			["unavailable", 503],
		] as const) {
			f.refreshOne.mockRejectedValueOnce(new GitRefreshError(kind, { cause: new Error("secret-canary") }));
			const response = await send("/services/missing/refresh");
			expect(response.status).toBe(status);
			expect(await response.text()).not.toContain("secret-canary");
		}
		expect((await fetch(`${f.origin}/api/ui/services/demo/refresh`)).status).toBe(405);
	} finally {
		await f.close();
	}
});

test("service events support authenticated GET and HEAD, no-store and missing services", async () => {
	const f = await fixture();
	try {
		const response = await fetch(`${f.origin}/api/ui/services/demo/events`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual([expect.objectContaining({ event: "reconciliation.failed" })]);
		expect(f.calls).toEqual(["demo"]);
		expect((await fetch(`${f.origin}/api/ui/services/demo/events`, { method: "HEAD" })).status).toBe(200);
		expect((await fetch(`${f.origin}/api/ui/services/missing/events`)).status).toBe(404);
	} finally {
		await f.close();
	}
	const unauthenticated = await fixture(false);
	try {
		expect((await fetch(`${unauthenticated.origin}/api/ui/services/demo/events`)).status).toBe(401);
		expect(unauthenticated.calls).toEqual([]);
	} finally {
		await unauthenticated.close();
	}
});

test("configuration writes require a session, same origin and bounded JSON before delegation", async () => {
	const f = await fixture();
	const update = { revision: "r1", changes: [{ path: "git.pollIntervalSeconds", value: 9 }] };
	const send = (body: string, headers: Record<string, string> = {}) =>
		fetch(`${f.origin}/api/ui/cluster/config`, {
			method: "PUT",
			headers: { origin: f.origin, "content-type": "application/json", "x-paas-config": "1", ...headers },
			body,
		});
	try {
		const saved = await send(JSON.stringify(update));
		expect(saved.status).toBe(200);
		expect(await saved.json()).toMatchObject({ revision: "saved" });
		expect(saved.headers.get("cache-control")).toBe("no-store");
		expect(f.updateConfig).toHaveBeenCalledWith(update);
		for (const [body, headers, status] of [
			[JSON.stringify(update), { origin: "https://evil.test" }, 403],
			[JSON.stringify(update), { "x-paas-config": "" }, 403],
			[JSON.stringify(update), { origin: "" }, 403],
			[JSON.stringify(update), { "content-type": "text/plain" }, 415],
			["{invalid", {}, 400],
			[JSON.stringify({ ...update, unexpected: true }), {}, 400],
			[JSON.stringify({ ...update, changes: "invalid" }), {}, 400],
			[JSON.stringify({ value: "x".repeat(70_000) }), {}, 413],
		] as const) {
			const response = await send(body, headers);
			expect(response.status, JSON.stringify(headers)).toBe(status);
			await response.body?.cancel();
		}
		expect(f.updateConfig).toHaveBeenCalledTimes(1);
		for (const [kind, status] of [
			["invalid", 400],
			["conflict", 409],
			["unavailable", 503],
		] as const) {
			f.updateConfig.mockRejectedValueOnce(new ConfigEditError(kind, { cause: new Error("secret-canary") }));
			const response = await send(JSON.stringify(update));
			expect(response.status).toBe(status);
			expect(await response.text()).not.toContain("secret-canary");
		}
		f.verifyAuthCookie.mockReturnValueOnce(undefined);
		expect((await send(JSON.stringify(update))).status).toBe(401);
		expect(f.updateConfig).toHaveBeenCalledTimes(4);
	} finally {
		await f.close();
	}
});

test("UI routes map requests, mark snapshots private and translate domain failures", async () => {
	const f = await fixture();
	const capture = captureLogs();
	try {
		for (const path of [
			"/cluster",
			"/services",
			"/services/demo/resources/app",
			"/services/demo/resources/app/containers/c/logs",
		]) {
			const response = await fetch(`${f.origin}/api/ui${path}`);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			await response.body?.cancel();
		}
		expect(f.calls).toEqual([
			["demo", "app"],
			["demo", "app", "c"],
		]);
		for (const [id, status] of [
			["missing", 404],
			["failed", 503],
		] as const) {
			const response = await fetch(`${f.origin}/api/ui/services/${id}`);
			expect(response.status).toBe(status);
			expect(await response.text()).not.toContain("stack");
		}
		const post = await fetch(`${f.origin}/api/ui/services`, { method: "POST" });
		expect(post.status).toBe(405);
		await post.body?.cancel();
	} finally {
		await f.close();
		capture.restore();
	}
	expect(capture.lines.map((line) => JSON.parse(line).err.message)).toEqual([
		"Requested item was not found",
		"Cluster data is unavailable; retry shortly",
	]);
});

test("UI authentication fails closed before reading cluster data", async () => {
	const f = await fixture(false);
	try {
		const response = await fetch(`${f.origin}/api/ui/services/demo`, {
			headers: { cookie: "__Secure-paas_session=session" },
		});
		expect(response.status).toBe(401);
		expect(f.verifyAuthCookie).toHaveBeenCalledWith("session");
		expect(f.calls).toEqual([]);
		await response.body?.cancel();
		f.verifyAuthCookie.mockClear();
		const duplicate = await fetch(`${f.origin}/api/ui/cluster`, {
			headers: { cookie: "__Secure-paas_session=session; __Secure-paas_session=other" },
		});
		expect(duplicate.status).toBe(401);
		expect(f.verifyAuthCookie).toHaveBeenCalledWith(undefined);
		await duplicate.body?.cancel();
	} finally {
		await f.close();
	}
});
