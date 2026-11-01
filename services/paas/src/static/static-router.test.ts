import Koa from "koa";
import { expect, test, vi } from "vitest";

import { startTestApi } from "../util/test/router.ts";
import { createStaticRouter } from "./static-router.ts";

test("serves GET/HEAD with content types, decodes once and isolates missing files and methods", async () => {
	const resolve = vi.fn(async (_host: string, path: string) =>
		path === "/a b.css"
			? { kind: "file" as const, path: "a b.css", content: new TextEncoder().encode("body{}") }
			: { kind: "missing" as const },
	);
	const api = await startTestApi(new Koa().use(createStaticRouter({ resolve })));
	try {
		const response = await fetch(`${api.origin}/a%20b.css`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/css");
		expect(await response.text()).toBe("body{}");
		expect(resolve).toHaveBeenCalledWith(new URL(api.origin).host, "/a b.css");
		expect((await fetch(`${api.origin}/a%20b.css`, { method: "HEAD" })).status).toBe(200);
		expect((await fetch(`${api.origin}/missing`)).status).toBe(404);
		expect((await fetch(`${api.origin}/%zz`)).status).toBe(400);
		expect((await fetch(`${api.origin}/`, { method: "POST" })).status).toBe(405);
		resolve.mockRejectedValueOnce(new Error("private path"));
		const failure = await fetch(`${api.origin}/`);
		expect(failure.status).toBe(503);
		expect(await failure.text()).not.toContain("private path");
	} finally {
		await api.close();
	}
});
