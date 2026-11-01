import { join } from "node:path/posix";

import type * as files from "../util/file.ts";
import { stringifyYaml } from "../util/yaml.ts";
import type { InternalRetention } from "./types.ts";

export interface IStorageAccess {
	/** Ordinary operations may overlap; maintenance waits for them and excludes new operations. */
	use<T>(operation: () => Promise<T>): Promise<T>;
}

export interface IInternalStorage extends IStorageAccess {
	/** Creates private internal directories and generates the Envoy bootstrap. */
	initialize(): Promise<void>;
	/** Deletes recognized obsolete generated artifacts only. Rejects on unsafe directories or I/O failure. */
	cleanup(retain: () => InternalRetention): Promise<void>;
}

/** Filesystem boundary for platform-owned output, including exclusion of live Git/static/file operations. */
export class InternalStorage implements IInternalStorage {
	private barrier: Promise<void> = Promise.resolve();
	private readonly active = new Set<Promise<unknown>>();
	constructor(
		private readonly root: string,
		private readonly fs: typeof files,
		private readonly configurationDirectory = "/etc/homelab-paas",
	) {}

	use<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.barrier.then(operation);
		this.active.add(result);
		void result.finally(() => this.active.delete(result)).catch(() => {});
		return result;
	}

	maintain<T>(operation: () => Promise<T>): Promise<T> {
		const pending = [this.barrier, ...this.active];
		const result = Promise.allSettled(pending).then(operation);
		this.barrier = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	async initialize(): Promise<void> {
		try {
			await this.directory(this.root, true);
			await this.directory(this.path(), true);
			await this.directory(this.path("envoy"), true);
			await this.directory(this.path("static"), true);
			await this.fs.atomicWriteFile(
				this.path("envoy/envoy.yaml"),
				stringifyYaml({
					node: { id: "homelab-paas-envoy", cluster: "homelab-paas" },
					admin: { address: { socket_address: { address: "0.0.0.0", port_value: 9901 } } },
					dynamic_resources: {
						cds_config: {
							resource_api_version: "V3",
							path_config_source: { path: "/var/homelab-paas/_paas/envoy/cds.yaml" },
						},
						lds_config: {
							resource_api_version: "V3",
							path_config_source: { path: "/var/homelab-paas/_paas/envoy/lds.yaml" },
						},
					},
				}),
				{ mode: 0o600 },
			);
		} catch (cause) {
			throw new Error("Cannot initialize internal platform storage; check paths and permissions", { cause });
		}
	}

	cleanup(retain: () => InternalRetention): Promise<void> {
		return this.maintain(async () => {
			try {
				await this.directory(this.path());
				await this.directory(this.path("envoy"));
				for (const name of await this.entries(this.path())) {
					const checkpoint = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.(?:state|events|health)\.yaml$/.exec(name);
					if (checkpoint && !retain().services.has(checkpoint[1]!)) await this.remove(this.path(name));
					else if (["cds.yaml", "lds.yaml", "sds.yaml", "ingress.pem"].includes(name)) {
						await this.remove(this.path(name));
					}
				}
				await this.cleanGit(retain);
				await this.cleanStatic(retain);
				for (const directory of [this.path(), this.path("envoy")]) await this.cleanTemporaryFiles(directory);
				await this.remove(this.path("ui-git"));
				if (await this.directory(join(this.root, "__paas"))) {
					await this.remove(join(this.root, "__paas/static"));
					if (!(await this.entries(join(this.root, "__paas"))).length)
						await this.remove(join(this.root, "__paas"));
				}
				await this.remove(join(this.configurationDirectory, "envoy.yaml"));
			} catch (cause) {
				throw new Error("Cannot clean internal platform output; will retry on the next cleanup", { cause });
			}
		});
	}

	private async cleanGit(retain: () => InternalRetention): Promise<void> {
		const root = this.path("git");
		for (const service of await this.entries(root)) {
			if (!this.identity(service)) continue;
			const directory = join(root, service);
			if (!retain().services.has(service)) {
				await this.remove(directory);
				continue;
			}
			for (const name of await this.entries(directory)) {
				const current = retain().git.has(`${service}/${name}`);
				const legacy = [
					"HEAD",
					"config",
					"description",
					"objects",
					"refs",
					"hooks",
					"info",
					"shallow",
					"FETCH_HEAD",
					"packed-refs",
					"known_hosts",
					"branches",
					"logs",
				].includes(name);
				if (!current && (/^[a-f0-9]{64}$/.test(name) || legacy)) await this.remove(join(directory, name));
			}
		}
	}

	private async cleanStatic(retain: () => InternalRetention): Promise<void> {
		const root = this.path("static");
		for (const service of await this.entries(root)) {
			if (!this.identity(service)) continue;
			const directory = join(root, service);
			if (!retain().services.has(service)) {
				await this.remove(directory);
				continue;
			}
			const entries = await this.entries(directory);
			for (const name of entries) {
				const required = retain().static?.get(service);
				const resource =
					/^\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.json$/.exec(name)?.[1]
					?? (this.identity(name) ? name : undefined);
				if (resource && required && !required.has(resource)) {
					const info = await this.fs.lstat(join(directory, name));
					if (!name.startsWith(".") && !info.isDirectory()) continue;
					const current = retain();
					const retainedResources = current.static?.get(service);
					if (info.mtimeMs < (current.before ?? 0) && retainedResources && !retainedResources.has(resource))
						await this.remove(join(directory, name));
				} else if (/^\.staging-[a-zA-Z0-9]+$/.test(name)) await this.remove(join(directory, name));
				else if (/^\.staging-[a-zA-Z0-9]+\.previous$/.test(name)) {
					// A failed promotion can leave the only working copy here. Keep it until all manifests have targets.
					const manifests = entries.filter((entry) => /^\.[a-z][a-z0-9-]*\.json$/.test(entry));
					if (
						manifests.length
						&& (
							await Promise.all(
								manifests.map((entry) => this.directory(join(directory, entry.slice(1, -5)))),
							)
						).every(Boolean)
					)
						await this.remove(join(directory, name));
				}
			}
			await this.cleanTemporaryFiles(directory);
		}
	}

	private async cleanTemporaryFiles(directory: string): Promise<void> {
		for (const name of await this.entries(directory))
			if (
				/^(?:[a-z][a-z0-9.-]*|\.[a-z][a-z0-9-]*\.json)\.[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.tmp$/.test(
					name,
				)
			)
				await this.remove(join(directory, name));
	}

	private path(name = ""): string {
		return join(this.root, "_paas", name);
	}
	private identity(name: string): boolean {
		return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name);
	}
	private async directory(path: string, create = false): Promise<boolean> {
		try {
			if (create) await this.fs.mkdir(path, { recursive: true, mode: 0o700 });
			if (!(await this.fs.lstat(path)).isDirectory()) throw new Error("Expected a real internal directory");
			if (create) await this.fs.chmod(path, 0o700);
			return true;
		} catch (error) {
			if (this.fs.isFileError(error, "ENOENT")) return false;
			throw error;
		}
	}
	private async entries(directory: string): Promise<string[]> {
		return (await this.directory(directory)) ? this.fs.readdir(directory) : [];
	}
	private async remove(path: string): Promise<void> {
		await this.fs.rm(path, { recursive: true, force: true });
	}
}
