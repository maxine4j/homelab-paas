import type { Endpoint } from "./contracts.ts";
import type { EngineTransport } from "./docker-client.ts";

export class NodeEngineTransport implements EngineTransport {
	constructor(
		private readonly socketPath: string,
		private readonly timeoutMs: number,
	) {}
	request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? undefined : JSON.stringify(body);
			const req = request(
				{
					socketPath: this.socketPath,
					path: `/v1.48${path}`,
					method,
					headers: payload
						? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
						: {},
				},
				(response) => {
					let content = "";
					response.setEncoding("utf8");
					response.on("data", (chunk: string) => {
						content += chunk;
						if (content.length > 32 * 1024 * 1024) req.destroy(new Error("Docker response too large"));
					});
					response.on("error", reject);
					response.on("end", () => resolve({ status: response.statusCode ?? 500, body: content }));
				},
			);
			const deadline = setTimeout(() => req.destroy(new Error("Docker operation timed out")), this.timeoutMs);
			req.on("close", () => clearTimeout(deadline));
			req.on("error", reject);
			req.end(payload);
		});
	}
}
export async function probeHttp(endpoint: Endpoint, path: string): Promise<boolean> {
	try {
		const host = endpoint.address.includes(":") ? `[${endpoint.address}]` : endpoint.address;
		const response = await fetch(`http://${host}:${endpoint.port}${path}`, {
			signal: AbortSignal.timeout(2000),
			redirect: "manual",
		});
		await response.body?.cancel();
		return response.status >= 200 && response.status < 300;
	} catch {
		return false;
	}
}
import { request } from "node:http";
