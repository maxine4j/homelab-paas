import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { NodeEngineTransport, probeHttp } from "./engine.ts";

test("Docker transport sends JSON over a Unix socket and returns complete streamed responses", async () => {
	const root = await mkdtemp(join(tmpdir(), "paas-engine-"));
	const socket = join(root, "docker.sock");
	const requests: { path?: string; method?: string; body: string }[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += String(chunk);
		requests.push({ path: req.url, method: req.method, body });
		res.statusCode = 201;
		res.write('{"status":"pulling"}\n');
		res.end('{"status":"done"}\n');
	});
	try {
		server.listen(socket);
		await once(server, "listening");
		const transport = new NodeEngineTransport(socket, 1000);
		expect(await transport.request("POST", "/images/create?fromImage=app", { Image: "app" })).toEqual({
			status: 201,
			body: '{"status":"pulling"}\n{"status":"done"}\n',
		});
		expect(requests).toEqual([
			{ path: "/v1.48/images/create?fromImage=app", method: "POST", body: '{"Image":"app"}' },
		]);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});
test("HTTP readiness accepts only 2xx responses without following redirects", async () => {
	const server = createServer((req, res) => {
		res.statusCode = req.url === "/health" ? 204 : 302;
		res.setHeader("Location", "/health");
		res.end();
	});
	try {
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		const endpoint = { address: "127.0.0.1", port: address.port };
		expect(await probeHttp(endpoint, "/health")).toBe(true);
		expect(await probeHttp(endpoint, "/redirect")).toBe(false);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
