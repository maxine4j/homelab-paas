import { join } from "node:path/posix";

import type * as files from "../util/file.ts";
import { parseYaml, stringifyYaml } from "../util/yaml.ts";
import type { IStorageAccess } from "./internal-storage.ts";
import type { KeyValueStore } from "./types.ts";

export interface IServiceStorage extends KeyValueStore<unknown> {
	/** Includes unconfigured services so their persisted routes can be withdrawn. */
	listServices(): Promise<string[]>;
}

export class ServiceStorage implements IServiceStorage {
	constructor(
		private readonly root: string,
		private readonly fs: typeof files,
		private readonly storage?: IStorageAccess,
	) {}
	async get(key: string): Promise<unknown> {
		const path = await this.path(key);
		const content = await this.fs.readFile(path);
		return content === undefined ? undefined : parseYaml(content, path);
	}
	async set(key: string, value: unknown): Promise<void> {
		const write = async () => {
			const path = await this.path(key, true);
			await this.fs.atomicWriteFile(path, stringifyYaml(value), { mode: 0o600 });
		};
		await (this.storage ? this.storage.use(write) : write());
	}
	async update(key: string, update: (value: unknown) => Promise<unknown>): Promise<void> {
		const next = await update(await this.get(key));
		if (next === undefined) await this.delete(key);
		else await this.set(key, next);
	}
	async delete(key: string): Promise<void> {
		const remove = async () => {
			await this.fs.rm(await this.path(key), { force: true });
		};
		await (this.storage ? this.storage.use(remove) : remove());
	}
	async listServices(): Promise<string[]> {
		const services: string[] = [];
		for (const name of await this.fs.readdir(this.root)) {
			if (!this.identity(name)) continue;
			const info = await this.fs.lstat(join(this.root, name));
			if (info.isSymbolicLink()) throw new Error("Expected a real service directory");
			if (info.isDirectory()) services.push(name);
		}
		return services;
	}
	private async path(key: string, create = false): Promise<string> {
		const [service, name, extra] = key.split(".");
		if (
			!service
			|| !this.identity(service)
			|| !name
			|| !["state", "events", "health", "routes"].includes(name)
			|| extra !== undefined
		)
			throw new Error("Invalid service storage key");
		const directory = join(this.root, service);
		if (create) await this.fs.mkdir(directory, { recursive: true, mode: 0o700 });
		try {
			if (!(await this.fs.lstat(directory)).isDirectory()) throw new Error("Expected a real service directory");
			if (create) await this.fs.chmod(directory, 0o700);
		} catch (error) {
			if (!this.fs.isFileError(error, "ENOENT")) throw error;
		}
		return join(directory, `${name}.yaml`);
	}
	private identity(value: string): boolean {
		return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && value.length <= 63;
	}
}
