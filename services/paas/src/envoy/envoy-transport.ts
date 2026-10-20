import { join } from "node:path";

import { atomicWriteFile, createFileIfMissing, mkdir } from "../util/file.ts";

/** Wire/filesystem boundary. Failures are translated by EnvoyClient. */
export interface IEnvoyTransport {
	createDiscoveryFile(name: "cds.yaml" | "lds.yaml", content: string): Promise<void>;
	writeDiscoveryFile(name: "cds.yaml" | "lds.yaml", content: string): Promise<void>;
	readConfigDump(): Promise<{ status: number; body: string }>;
}

/** Atomic filesystem xDS updates and bounded access to a private admin API. */
export class NodeEnvoyTransport implements IEnvoyTransport {
	constructor(
		private readonly options: {
			directory: string;
			adminUrl: string;
			timeoutMs: number;
			maxResponseBytes: number;
		},
	) {}

	async writeDiscoveryFile(name: "cds.yaml" | "lds.yaml", content: string): Promise<void> {
		await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
		await atomicWriteFile(join(this.options.directory, name), content, { mode: 0o600 });
	}

	async createDiscoveryFile(name: "cds.yaml" | "lds.yaml", content: string): Promise<void> {
		await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
		await createFileIfMissing(join(this.options.directory, name), content, { mode: 0o600 });
	}

	async readConfigDump(): Promise<{ status: number; body: string }> {
		const response = await fetch(new URL("/config_dump", this.options.adminUrl), {
			signal: AbortSignal.timeout(this.options.timeoutMs),
			redirect: "error",
		});
		if (!response.body) throw new Error("Envoy response is incomplete");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > this.options.maxResponseBytes) throw new Error("Envoy response exceeds byte limit");
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
		}
		return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
	}
}
