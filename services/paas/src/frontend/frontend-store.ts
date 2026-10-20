import { resolve } from "node:path";

import type { lstat } from "../util/file.ts";
import { UiUnavailableError } from "./frontend-service.ts";
import type { UiEntry, UiFiles } from "./frontend-service.ts";

/** Filesystem adapter. Never follows a symlink beneath the configured UI root. */
export class DirectoryUiFiles implements UiFiles {
	private readonly cache = new Map<string, Uint8Array>();
	private readonly directory: string;
	constructor(
		directory: string,
		private readonly inspectFile: typeof lstat,
		private readonly readFile: (path: string) => Promise<Uint8Array>,
	) {
		this.directory = directory;
	}

	async inspect(path: string): Promise<UiEntry> {
		if (path.includes("\\") || path.includes("\0") || path.split("/").some((part) => part.startsWith(".")))
			return "blocked";
		if (this.cache.has(path)) return "file";
		let current = resolve(this.directory);
		let file = false;
		try {
			for (const component of path.split("/").filter(Boolean)) {
				current = resolve(current, component);
				const info = await this.inspectFile(current);
				if (info.isSymbolicLink()) return "blocked";
				file = info.isFile();
			}
			return file ? "file" : "missing";
		} catch (error) {
			if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code)))
				return "missing";
			throw new UiUnavailableError({ cause: error });
		}
	}

	async read(path: string): Promise<Uint8Array> {
		const cached = this.cache.get(path);
		if (cached) return cached;
		if ((await this.inspect(path)) !== "file") throw new UiUnavailableError();
		try {
			const content = await this.readFile(resolve(this.directory, path));
			this.cache.set(path, content);
			return content;
		} catch (error) {
			throw new UiUnavailableError({ cause: error });
		}
	}
}
