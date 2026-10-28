import { request } from "node:http";

import type { ISleep } from "../util/sleep.ts";

/** Internal wire boundary. Implementations own connection settings and default deadlines.
 * A supplied timeoutMs overrides the default for this entire request only.
 */
export interface IDockerTransport {
	request(
		method: string,
		path: string,
		body?: unknown,
		timeoutMs?: number,
	): Promise<{ status: number; body: string; bytes?: Uint8Array }>;
}

export interface DockerTransportOptions {
	socketPath: string;
	timeoutMs: number;
	maxResponseBytes: number;
}

export interface IDockerLogTransport {
	/** Resolves after successful response headers. Aborting cancels headers and body consumption. */
	stream(path: string, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}

/** HTTP transport for Docker API v1.48 over a Unix socket. */
export class NodeDockerTransport implements IDockerTransport, IDockerLogTransport {
	constructor(
		private readonly options: DockerTransportOptions,
		private readonly sleep: ISleep,
	) {}

	stream(path: string, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
		return new Promise((resolve, reject) => {
			const deadline = new AbortController();
			const req = request(
				{ socketPath: this.options.socketPath, path: `/v1.48${path}`, method: "GET", signal },
				(response) => {
					deadline.abort();
					if (response.statusCode !== 200) {
						response.destroy();
						reject(new Error(`Docker log stream failed: HTTP ${response.statusCode ?? "unknown"}`));
						return;
					}
					resolve(response);
				},
			);
			void this.sleep(this.options.timeoutMs, deadline.signal).then(
				() => {
					if (!deadline.signal.aborted) req.destroy(new Error("Docker stream headers timed out"));
				},
				(cause: unknown) => {
					if (!deadline.signal.aborted) req.destroy(new Error("Docker stream deadline failed", { cause }));
				},
			);
			req.on("close", () => deadline.abort());
			req.on("error", reject);
			req.end();
		});
	}

	request(
		method: string,
		path: string,
		body?: unknown,
		timeoutMs?: number,
	): Promise<{ status: number; body: string; bytes?: Uint8Array }> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? undefined : JSON.stringify(body);
			const req = request(
				{
					socketPath: this.options.socketPath,
					path: `/v1.48${path}`,
					method,
					headers:
						payload === undefined
							? {}
							: {
									"content-type": "application/json",
									"content-length": Buffer.byteLength(payload),
								},
				},
				(response) => {
					const chunks: Buffer[] = [];
					let bytes = 0;
					response.on("data", (chunk: Buffer) => {
						bytes += chunk.length;
						if (bytes > this.options.maxResponseBytes) {
							const error = new Error("Docker response exceeds byte limit");
							reject(error);
							req.destroy(error);
							return;
						}
						chunks.push(chunk);
					});
					response.on("error", reject);
					response.on("end", () => {
						if (!response.complete || response.statusCode === undefined) {
							reject(new Error("Docker response is incomplete"));
							return;
						}
						const bytes = Buffer.concat(chunks);
						resolve({ status: response.statusCode, body: bytes.toString("utf8"), bytes });
					});
				},
			);
			const deadline = new AbortController();
			void this.sleep(timeoutMs ?? this.options.timeoutMs, deadline.signal).then(
				() => {
					if (!deadline.signal.aborted) req.destroy(new Error("Docker request timed out"));
				},
				() => {
					if (!deadline.signal.aborted) req.destroy(new Error("Docker deadline failed"));
				},
			);
			req.on("close", () => deadline.abort());
			req.on("error", reject);
			req.end(payload);
		});
	}
}
