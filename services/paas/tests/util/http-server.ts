import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";

import type { CapturedRequest, MockHandler } from "./types.ts";

/** Node's HTTP adapter permits the explicit Host needed for virtual-host routing tests. */
export const requestHttp = (url: string, headers: Record<string, string>): Promise<Response> =>
	new Promise((resolve, reject) => {
		const req = httpRequest(url, { headers, timeout: 5000 }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("error", reject);
			res.on("end", () => {
				const responseHeaders = new Headers();
				for (const [key, value] of Object.entries(res.headers))
					for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
						responseHeaders.append(key, item);
				resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
			});
		});
		req.on("timeout", () => req.destroy(new Error("HTTP observation timed out")));
		req.on("error", reject);
		req.end();
	});

/** Small protocol listener: unexpected requests and handler failures fail teardown. */
export class MockHttpServer {
	readonly requests: CapturedRequest[] = [];
	private readonly failures: unknown[] = [];
	private readonly server;
	url = "";

	constructor(handler: MockHandler) {
		this.server = createServer(async (req, res) => {
			try {
				const chunks: Buffer[] = [];
				let bytes = 0;
				for await (const chunk of req) {
					bytes += chunk.length;
					if (bytes > 1024 * 1024) throw new Error("Mock request exceeds 1 MiB");
					chunks.push(chunk);
				}
				const request = {
					method: req.method ?? "GET",
					url: new URL(req.url ?? "/", "http://mock"),
					headers: req.headers,
					body: Buffer.concat(chunks).toString(),
				};
				this.requests.push(request);
				const response = await handler(request);
				if (!response) throw new Error(`Unexpected mock request: ${request.method} ${request.url.pathname}`);
				res.statusCode = response.status;
				response.headers.forEach((value, key) => res.setHeader(key, value));
				if (response.headers.getSetCookie().length)
					res.setHeader("set-cookie", response.headers.getSetCookie());
				res.end(Buffer.from(await response.arrayBuffer()));
			} catch (error) {
				this.failures.push(error);
				res.writeHead(500).end("Mock handler failed");
			}
		});
	}

	async listen(socketPath?: string): Promise<this> {
		if (socketPath) this.server.listen(socketPath);
		else this.server.listen(0, "0.0.0.0");
		await once(this.server, "listening");
		const address = this.server.address();
		if (address && typeof address !== "string") this.url = `http://127.0.0.1:${address.port}`;
		return this;
	}

	assertClean(): void {
		if (this.failures.length) throw new AggregateError(this.failures, "Unexpected mock traffic");
	}

	async close(): Promise<void> {
		if (!this.server.listening) {
			this.assertClean();
			return;
		}
		this.server.closeAllConnections();
		await new Promise<void>((resolve, reject) => this.server.close((error) => (error ? reject(error) : resolve())));
		this.assertClean();
	}
}
