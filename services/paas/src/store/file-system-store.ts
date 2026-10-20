import path from "node:path/posix";

import { parseYaml, stringifyYaml } from "../util/yaml.ts";
import type { KeyValueStore, StoreCodec } from "./types.ts";

/**
 * One JSON or YAML file per logical key, with the matching extension.
 * Values must be serialization compatible; callers serialize concurrent mutations.
 * Readers return undefined only for missing files and propagate other failures.
 * Injected writers own directory creation, private permissions and atomic replacement.
 */
export class FileSystemKeyValueStore<TValue> implements KeyValueStore<TValue> {
	constructor(
		private readonly baseDirectory: string,
		private readonly readFile: (path: string) => Promise<string | undefined>,
		private readonly writeFile: (path: string, data: string) => Promise<void>,
		private readonly deleteFile: (path: string) => Promise<void>,
		private readonly format: "json" | "yaml" | StoreCodec<TValue> = "json",
	) {}

	async get(key: string): Promise<TValue | undefined> {
		const filePath = this.filePath(key);
		const content = await this.readFile(filePath);
		if (content === undefined) return undefined;
		return (
			typeof this.format === "object"
				? this.format.deserialize(content)
				: this.format === "yaml"
					? parseYaml(content, filePath)
					: JSON.parse(content)
		) as TValue;
	}
	async set(key: string, value: TValue): Promise<void> {
		const filePath = this.filePath(key);
		const content =
			typeof this.format === "object"
				? this.format.serialize(value)
				: this.format === "yaml"
					? stringifyYaml(value)
					: JSON.stringify(value);
		if (content === undefined) throw new Error("Value is not JSON serializable");
		await this.writeFile(filePath, content);
	}
	async update(key: string, updateFn: (value: TValue | undefined) => Promise<TValue | undefined>): Promise<void> {
		const nextValue = await updateFn(await this.get(key));
		if (nextValue === undefined) await this.delete(key);
		else await this.set(key, nextValue);
	}
	async delete(key: string): Promise<void> {
		const filePath = this.filePath(key);
		try {
			await this.deleteFile(filePath);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
	}

	private filePath(key: string): string {
		if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(key)) {
			throw new Error("Invalid store key");
		}
		const extension = typeof this.format === "object" ? this.format.extension : this.format;
		if (!/^[a-z0-9]+$/.test(extension)) throw new Error("Invalid store extension");
		return path.resolve(this.baseDirectory, `${key}.${extension}`);
	}
}
