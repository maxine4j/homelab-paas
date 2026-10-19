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
