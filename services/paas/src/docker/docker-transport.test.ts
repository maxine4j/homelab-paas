import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { mkdtemp, rm } from "../util/file.ts";
import { sleep } from "../util/sleep.ts";
import { DockerClient } from "./docker-client.ts";
import { DockerLogClient } from "./docker-log-client.ts";
import { NodeDockerTransport } from "./docker-transport.ts";

test("uses the injected deadline and cancels it when the request closes", async () => {
	const signals: AbortSignal[] = [];
	const delays: number[] = [];
	const transport = new NodeDockerTransport(
		{ socketPath: "/nonexistent/docker.sock", timeoutMs: 123, maxResponseBytes: 1024 },
		async (ms, signal) => {
			delays.push(ms);
			if (signal) signals.push(signal);
			await new Promise<void>(() => {});
		},
	);
	await expect(transport.request("GET", "/test")).rejects.toThrow();
	expect(delays).toEqual([123]);
	const signal = signals.at(0);
	if (!signal) throw new Error("Deadline cancellation signal was not supplied");
	if (!signal.aborted) await once(signal, "abort");
	expect(signal.aborted).toBe(true);
});

test("follows a real Unix-socket response and abort closes the underlying Engine connection", async () => {
	let closed: Promise<unknown> = Promise.resolve();
	let path: string | undefined;
	await withServer(
		(req, res) => {
			path = req.url;
			closed = once(res, "close");
			res.write("live line\n");
		},
		async (socketPath) => {
			const controller = new AbortController();
			const client = new DockerLogClient(
				new NodeDockerTransport({ socketPath, timeoutMs: 1000, maxResponseBytes: 1024 }, sleep),
			);
			const output: string[] = [];
			await client.follow(
				"container",
				(text) => {
					output.push(text);
					controller.abort();
				},
				controller.signal,
			);
			await closed;
			expect(output).toEqual(["live line\n"]);
		},
	);
	expect(path).toBe("/v1.48/containers/container/logs?stdout=true&stderr=true&timestamps=true&tail=200&follow=true");
});

test("stream header deadlines, HTTP failures and incomplete bodies retain safe client failures", async () => {
	for (const mode of ["deadline", "status", "disconnect"] as const) {
		await withServer(
			(_req, res) => {
				if (mode === "status") res.writeHead(500).end("private Engine error");
				if (mode === "disconnect") {
					res.write("some output");
					res.destroy(new Error("private transport cause"));
				}
			},
			async (socketPath) => {
				const client = new DockerLogClient(
					new NodeDockerTransport({ socketPath, timeoutMs: 30, maxResponseBytes: 1024 }, sleep),
				);
				await expect(client.follow("container", () => {}, new AbortController().signal)).rejects.toMatchObject({
					message: "Docker operation failed (unavailable)",
				});
			},
		);
	}
});

async function withServer(listener: RequestListener, run: (socketPath: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "docker-client-"));
	const socketPath = join(root, "socket");
	const server = createServer(listener);
	try {
		server.listen(socketPath);
		await once(server, "listening");
		await run(socketPath);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
}

test("the client creates containers over its own socket transport", async () => {
	const requests: { path?: string; method?: string; body: string; length?: string }[] = [];
	await withServer(
		async (req, res) => {
			let body = "";
			for await (const chunk of req) body += String(chunk);
			requests.push({ path: req.url, method: req.method, body, length: req.headers["content-length"] });
			res.writeHead(201, { "content-type": "application/json" });
			res.end('{"Id":"c"}');
		},
		async (socketPath) => {
			const client = new DockerClient(
				new NodeDockerTransport({ socketPath, timeoutMs: 1000, maxResponseBytes: 1024 }, sleep),
			);
			expect(await client.createContainer({ name: "app", image: "app:1", env: { VALUE: "é" } })).toBe("c");
		},
	);
	const body = JSON.stringify({ Image: "app:1", Env: ["VALUE=é"], HostConfig: {} });
	expect(requests).toEqual([
		{ method: "POST", path: "/v1.48/containers/create?name=app", body, length: String(Buffer.byteLength(body)) },
	]);
});

test("collects streamed pull events and sends requests without bodies", async () => {
	await withServer(
		(req, res) => {
			expect(req.headers["content-length"]).toBeUndefined();
			res.write('{"status":"pulling"}\n');
			res.end('{"status":"done"}\n');
		},
		async (socketPath) => {
			const transport = new NodeDockerTransport({ socketPath, timeoutMs: 1000, maxResponseBytes: 1024 }, sleep);
			expect(await transport.request("GET", "/test")).toEqual({
				status: 200,
				body: '{"status":"pulling"}\n{"status":"done"}\n',
				bytes: Buffer.from('{"status":"pulling"}\n{"status":"done"}\n'),
			});
		},
	);
});

test("bounds the entire request even when the server never sends headers", async () => {
	await withServer(
		() => {},
		async (socketPath) => {
			const client = new DockerClient(
				new NodeDockerTransport({ socketPath, timeoutMs: 30, maxResponseBytes: 1024 }, sleep),
			);
			await expect(client.listContainers()).rejects.toMatchObject({ kind: "unavailable" });
		},
	);
});

test.each([30, 300])(
	"allows the full %s-second stop timeout plus five seconds without changing other deadlines",
	async (timeoutSeconds) => {
		const delays: number[] = [];
		await withServer(
			(req, res) => {
				if (req.url?.includes("/stop?")) {
					res.writeHead(204);
					res.end();
				} else {
					res.end("[]");
				}
			},
			async (socketPath) => {
				const client = new DockerClient(
					new NodeDockerTransport(
						{ socketPath, timeoutMs: 120000, maxResponseBytes: 1024 },
						async (ms, signal) => {
							delays.push(ms);
							if (signal) await once(signal, "abort");
						},
					),
				);
				await client.stopContainer("app", timeoutSeconds);
				await client.listContainers();
			},
		);
		expect(delays).toEqual([(timeoutSeconds + 5) * 1000, 120000]);
	},
);

test("bounds response bytes including multibyte text", async () => {
	await withServer(
		(_req, res) => {
			res.end("ééé");
		},
		async (socketPath) => {
			const transport = new NodeDockerTransport({ socketPath, timeoutMs: 1000, maxResponseBytes: 5 }, sleep);
			await expect(transport.request("GET", "/test")).rejects.toThrow("Docker response exceeds byte limit");
		},
	);
});

test("rejects interrupted responses rather than returning partial JSON", async () => {
	await withServer(
		(_req, res) => {
			res.writeHead(200, { "content-length": 100 });
			res.write('{"Id":');
			res.socket?.end();
		},
		async (socketPath) => {
			const client = new DockerClient(
				new NodeDockerTransport({ socketPath, timeoutMs: 1000, maxResponseBytes: 1024 }, sleep),
			);
			await expect(client.inspectImage("app")).rejects.toMatchObject({ kind: "unavailable" });
		},
	);
});

test("translates socket connection failures through the client error contract", async () => {
	const client = new DockerClient(
		new NodeDockerTransport(
			{ socketPath: "/nonexistent/docker.sock", timeoutMs: 1000, maxResponseBytes: 1024 },
			sleep,
		),
	);
	await expect(client.listContainers()).rejects.toMatchObject({ kind: "unavailable" });
});
