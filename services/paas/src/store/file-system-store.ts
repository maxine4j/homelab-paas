import path from "node:path/posix";

import type { KeyValueStore } from "./types.ts";

/**
 * One JSON file per key in an existing, store-owned directory.
 * Values must be JSON compatible; callers serialize concurrent mutations.
 * Readers return undefined only for missing files and propagate other failures.
 * Writers own directory permissions and atomic replacement of files.
 */
export class FileSystemKeyValueStore<TValue> implements KeyValueStore<TValue> {
	constructor(
		private readonly baseDirectory: string,
		private readonly readFile: (path: string) => Promise<string | undefined>,
		private readonly writeFile: (path: string, data: string) => Promise<void>,
		private readonly deleteFile: (path: string) => Promise<void>,
	) {}

	async get(key: string): Promise<TValue | undefined> {
		const filePath = this.filePath(key);
		const content = await this.readFile(filePath);
		return content === undefined ? undefined : (JSON.parse(content) as TValue);
	}
	async set(key: string, value: TValue): Promise<void> {
		const filePath = this.filePath(key);
		const content = JSON.stringify(value);
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
		if (!key || /[./\\\0]/.test(key)) {
			throw new Error("Invalid store key");
		}
		return path.resolve(this.baseDirectory, key);
	}
}
