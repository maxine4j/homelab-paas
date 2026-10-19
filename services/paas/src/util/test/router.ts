import { once } from "node:events";

import type Koa from "koa";

export async function startTestApi<State, Context>(app: Koa<State, Context>) {
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing test server address");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}
