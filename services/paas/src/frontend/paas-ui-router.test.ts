import Koa from "koa";
import { expect, test, vi } from "vitest";

import { captureLogs } from "../util/test/logs.ts";
import { startTestApi } from "../util/test/router.ts";
import { createPaasUiRouter } from "./paas-ui-router.ts";
import { PaasUiError, type IPaasUiService } from "./paas-ui-service.ts";

const fixture = async (authenticated = true) => {
	const calls: unknown[] = [];
	const service: IPaasUiService = {
		async getCluster() {
			return { clusterId: "local", config: {} };
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
			return { resourceId: args[1], type: "web", containers: [] };
		},
		async getLogs(...args) {
			calls.push(args);
			return { containerId: args[2], content: "hello", tail: 200 };
		},
	};
	const verifyAuthCookie = vi.fn(() => (authenticated ? { userId: "owner" } : undefined));
	const router = createPaasUiRouter(service, { verifyAuthCookie });
	const server = await startTestApi(new Koa().use(router.routes()).use(router.allowedMethods()));
	return { ...server, calls, verifyAuthCookie };
};

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
