import { createHash } from "node:crypto";

import type { FileReader, FileWriter } from "../util/file.ts";
import { parseSecretEnv, serializeSecretEnv } from "./secret-env.ts";
import type { SecretDocument } from "./types.ts";

export interface ISecretStore {
	/** Reads validated values; public messages are safe. Infrastructure causes are for operator logs only. */
	read(serviceId: string): Promise<SecretDocument>;
	/** Serializes compare-and-merge writes; empty edits delete entries. Throws SecretEditError for invalid/conflicting/unavailable state. */
	update(serviceId: string, revision: string, changes: { name: string; value: string }[]): Promise<SecretDocument>;
}

export class SecretEditError extends Error {
	constructor(
		readonly kind: "invalid" | "conflict" | "unavailable" | "not-found",
		options?: ErrorOptions,
	) {
		super(
			kind === "invalid"
				? "Invalid secrets: use valid variable names and single-line values without NUL or both quote characters"
				: kind === "conflict"
					? "Secrets changed. Try again."
					: kind === "not-found"
						? "Service is not configured"
						: "Secrets are unavailable; check service env file access and syntax",
			options,
		);
	}
}

export class SecretStore implements ISecretStore {
	private pending: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly directory: string,
		private readonly readFile: FileReader,
		private readonly writeFile: FileWriter,
	) {}
	async read(serviceId: string): Promise<SecretDocument> {
		this.assertIdentity(serviceId);
		try {
			return this.document(await this.readFile(`${this.directory}/${serviceId}.env`));
		} catch (cause) {
			throw new SecretEditError("unavailable", { cause });
		}
	}
	update(serviceId: string, revision: string, changes: { name: string; value: string }[]): Promise<SecretDocument> {
		const operation = this.pending
			.catch(() => {})
			.then(async () => {
				this.assertIdentity(serviceId);
				try {
					if (
						!Array.isArray(changes)
						|| !changes.length
						|| changes.length > 256
						|| new Set(changes.map((change) => change.name)).size !== changes.length
					)
						throw new Error();
					if (
						changes.some(
							(change) =>
								typeof change.name !== "string"
								|| change.name.startsWith("PAAS_")
								|| typeof change.value !== "string"
								|| change.value.length > 16384,
						)
					)
						throw new Error();
					serializeSecretEnv(new Map(changes.map((change) => [change.name, change.value])));
				} catch {
					throw new SecretEditError("invalid");
				}
				const current = await this.read(serviceId);
				if (current.revision !== revision) throw new SecretEditError("conflict");
				for (const change of changes) {
					if (change.value === "") current.values.delete(change.name);
					else current.values.set(change.name, change.value);
				}
				try {
					const content = serializeSecretEnv(current.values);
					if (Buffer.byteLength(content) > 64 * 1024) throw new SecretEditError("invalid");
					await this.writeFile(`${this.directory}/${serviceId}.env`, content, { mode: 0o600 });
					return this.document(content);
				} catch (error) {
					if (error instanceof SecretEditError) throw error;
					throw new SecretEditError("unavailable", { cause: error });
				}
			});
		this.pending = operation;
		return operation;
	}
	private document(content: string | undefined): SecretDocument {
		if (content && Buffer.byteLength(content) > 64 * 1024) throw new Error();
		return {
			revision: createHash("sha256")
				.update(content === undefined ? "absent" : `present:${content}`)
				.digest("hex"),
			values: parseSecretEnv(content ?? ""),
		};
	}
	private assertIdentity(serviceId: string): void {
		if (serviceId.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId))
			throw new SecretEditError("not-found");
	}
}
