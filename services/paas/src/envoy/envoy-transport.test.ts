import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { NodeEnvoyTransport } from "./envoy-transport.ts";

test("atomically replaces discovery files with restricted permissions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-envoy-"));
	try {
		const transport = new NodeEnvoyTransport({
			directory,
			adminUrl: "http://127.0.0.1:1",
			timeoutMs: 1000,
			maxResponseBytes: 1024,
		});
		await transport.writeDiscoveryFile("cds.yaml", "first");
		await transport.writeDiscoveryFile("cds.yaml", "replacement");
		expect(await readFile(join(directory, "cds.yaml"), "utf8")).toBe("replacement");
		expect(await readdir(directory)).toEqual(["cds.yaml"]);
		expect((await stat(join(directory, "cds.yaml"))).mode & 0o777).toBe(0o600);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("reads admin status and body and enforces the response size limit", async () => {
	const paths: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		paths.push(request.url);
		if (paths.length === 3) return;
		response.writeHead(503);
		response.end("unavailable");
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server address");
		const options = {
			directory: tmpdir(),
			adminUrl: `http://127.0.0.1:${address.port}`,
			timeoutMs: 1000,
			maxResponseBytes: 1024,
		};
		expect(await new NodeEnvoyTransport(options).readConfigDump()).toEqual({ status: 503, body: "unavailable" });
		await expect(new NodeEnvoyTransport({ ...options, maxResponseBytes: 1 }).readConfigDump()).rejects.toThrow(
			"byte limit",
		);
		await expect(new NodeEnvoyTransport({ ...options, timeoutMs: 50 }).readConfigDump()).rejects.toThrow();
		expect(paths).toEqual(["/config_dump", "/config_dump", "/config_dump"]);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});
