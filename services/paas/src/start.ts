import { once } from "node:events";

import Koa from "koa";

import { createHealthCheckRouter } from "./util/healthcheck.ts";
import type { Lifecycle } from "./util/lifecycle.ts";

export async function start(lifecycle: Lifecycle): Promise<void> {
	const app = new Koa().use(createHealthCheckRouter().routes());
	const server = app.listen(8080, "0.0.0.0");
	lifecycle.registerShutdownHandler(
		() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	);
	await once(server, "listening");
}
