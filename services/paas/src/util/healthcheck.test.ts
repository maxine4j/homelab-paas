import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";

import { expect, test } from "vitest";

import { probe } from "./healthcheck.ts";

async function withServer(listener: RequestListener, run: (port: number) => Promise<void>, host = "127.0.0.1") {
	const server = createServer(listener);
	try {
		server.listen(0, host);
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		await run(address.port);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

test.each([200, 201, 204, 299, 300, 404, 503])("probe accepts only HTTP 200: %s", async (status) => {
	await withServer(
		(_req, res) => {
			res.writeHead(status);
			res.end();
		},
		async (port) => {
			expect(await probe("127.0.0.1", port, "/health")).toBe(status === 200);
		},
	);
});

test("probe uses the supplied port and path without following redirects", async () => {
	const requests: (string | undefined)[] = [];
	await withServer(
		(req, res) => {
			requests.push(req.url);
			res.writeHead(req.url === "/ready?full=1" ? 302 : 200, { Location: "/destination" });
			res.end();
		},
		async (port) => {
			expect(await probe("127.0.0.1", port, "/ready?full=1")).toBe(false);
		},
	);
	expect(requests).toEqual(["/ready?full=1"]);
});

test("probe supports IPv6 addresses", async () => {
	await withServer(
		(_req, res) => {
			res.end();
		},
		async (port) => {
			expect(await probe("::1", port, "/health")).toBe(true);
		},
		"::1",
	);
});

test("probe cancels response bodies instead of waiting for a body to finish", async () => {
	await withServer(
		(_req, res) => {
			res.writeHead(200);
			res.flushHeaders();
		},
		async (port) => {
			expect(await probe("127.0.0.1", port, "/health")).toBe(true);
		},
	);
});

test("probe bounds requests to two seconds when a server never sends headers", async () => {
	await withServer(
		() => {},
		async (port) => {
			const started = performance.now();
			expect(await probe("127.0.0.1", port, "/health")).toBe(false);
			expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
		},
	);
});

test("probe returns false for connection failures and malformed addresses", async () => {
	let closedPort = 0;
	await withServer(
		(_req, res) => res.end(),
		async (port) => {
			closedPort = port;
		},
	);
	expect(await probe("127.0.0.1", closedPort, "/health")).toBe(false);
	expect(await probe("invalid address", 80, "/health")).toBe(false);
});
