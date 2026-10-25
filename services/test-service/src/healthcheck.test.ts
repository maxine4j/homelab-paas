import { once } from "node:events";

import Koa from "koa";
import { expect, test } from "vitest";

import { createHealthCheckRouter } from "./healthcheck.ts";

test("the descriptor health endpoint reports readiness", async () => {
	const server = new Koa().use(createHealthCheckRouter().routes()).listen(0, "127.0.0.1");
	try {
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		const response = await fetch(`http://127.0.0.1:${address.port}/health`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "up" });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});

test("reports controlled readiness and version without exposing arbitrary headers", async () => {
	const server = new Koa()
		.use(createHealthCheckRouter({ ready: false, version: "v2" }).routes())
		.listen(0, "127.0.0.1");
	try {
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		const url = `http://127.0.0.1:${address.port}`;
		expect((await fetch(`${url}/health`)).status).toBe(503);
		const response = await fetch(`${url}/inspect`, { headers: { cookie: "app=yes", authorization: "secret" } });
		expect(await response.json()).toEqual({ version: "v2", cookie: "app=yes" });
		expect(await (await fetch(`${url}/version`)).json()).toEqual({ version: "v2" });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
