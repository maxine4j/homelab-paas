import { request } from "node:http";

/** Internal wire boundary. Implementations own connection settings and deadlines. */
export interface IDockerTransport {
	request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }>;
}

export interface DockerTransportOptions {
	socketPath: string;
	timeoutMs: number;
	maxResponseBytes: number;
}

/** HTTP transport for Docker API v1.48 over a Unix socket. */
export class NodeDockerTransport implements IDockerTransport {
	constructor(private readonly options: DockerTransportOptions) {}

	request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
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
						resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") });
					});
				},
			);
			const deadline = setTimeout(
				() => req.destroy(new Error("Docker request timed out")),
				this.options.timeoutMs,
			);
			req.on("close", () => clearTimeout(deadline));
			req.on("error", reject);
			req.end(payload);
		});
	}
}
