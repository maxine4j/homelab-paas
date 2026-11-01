import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { GitDirectoryFile } from "../git/types.ts";
import type { IStorageAccess } from "../store/internal-storage.ts";
import type * as files from "../util/file.ts";
import type { StaticIdentity, StaticSnapshot } from "./types.ts";

export interface IStaticStore {
	/** Stages a complete bundle before replacement. Throws StaticStoreError; prior content survives staging failures. */
	publish(identity: StaticIdentity, bundle: GitDirectoryFile[]): Promise<void>;
	/** Checks published identity and every file. Throws StaticStoreError on I/O failures. */
	inspect(identity: StaticIdentity): Promise<StaticSnapshot>;
	/** Reads regular files only; unsafe paths and missing files return undefined. Throws StaticStoreError on I/O failures. */
	read(serviceId: string, resourceId: string, path: string): Promise<Uint8Array | undefined>;
}

export class StaticStoreError extends Error {
	constructor(options?: ErrorOptions) {
		super("Static content storage is unavailable; check bundle paths and platform storage", options);
		this.name = "StaticStoreError";
	}
}

export class StaticStore implements IStaticStore {
	private readonly pending = new Map<string, Promise<unknown>>();
	constructor(
		private readonly root: string,
		private readonly fs: typeof files,
		private readonly storage?: IStorageAccess,
	) {}
	publish(identity: StaticIdentity, bundle: GitDirectoryFile[]): Promise<void> {
		return this.serialize(identity.serviceId, identity.resourceId, async () => {
			if (
				bundle.some((file) => !this.safePath(file.path))
				|| new Set(bundle.map((file) => file.path)).size !== bundle.length
			)
				throw new Error("Invalid static bundle paths");
			const parent = join(this.root, identity.serviceId);
			await this.fs.mkdir(parent, { recursive: true, mode: 0o700 });
			if (!(await this.fs.lstat(parent)).isDirectory()) throw new Error("Invalid static service directory");
			const temporary = await this.fs.mkdtemp(join(parent, ".staging-"));
			const target = join(parent, identity.resourceId);
			const backup = `${temporary}.previous`;
			let previous = false;
			let published = false;
			try {
				for (const file of bundle) {
					const destination = join(temporary, file.path);
					await this.fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
					await this.fs.writeFile(destination, file.content, { mode: 0o600, flag: "wx" });
				}
				try {
					await this.fs.rename(target, backup);
					previous = true;
				} catch (error) {
					if (!this.fs.isFileError(error, "ENOENT")) throw error;
				}
				try {
					await this.fs.rename(temporary, target);
					published = true;
				} catch (error) {
					if (previous) await this.fs.rename(backup, target);
					throw error;
				}
				await this.fs.atomicWriteFile(
					join(parent, `.${identity.resourceId}.json`),
					JSON.stringify({
						revision: identity.revision,
						path: identity.path,
						files: this.digests(bundle),
					}),
				);
			} finally {
				await this.fs.rm(temporary, { recursive: true, force: true });
				if (published) await this.fs.rm(backup, { recursive: true, force: true });
			}
		});
	}

	inspect(identity: StaticIdentity): Promise<StaticSnapshot> {
		return this.serialize(identity.serviceId, identity.resourceId, async () => {
			const parent = join(this.root, identity.serviceId);
			try {
				if (!(await this.fs.lstat(parent)).isDirectory()) return "different";
				const content = await this.fs.readFile(join(parent, `.${identity.resourceId}.json`));
				if (!content) return "missing";
				const parsed = z
					.strictObject({
						revision: z.string(),
						path: z.string(),
						files: z.array(z.tuple([z.string(), z.string()])),
					})
					.safeParse(JSON.parse(content));
				if (!parsed.success || parsed.data.revision !== identity.revision || parsed.data.path !== identity.path)
					return "different";
				const bundle = await this.scan(join(parent, identity.resourceId));
				return bundle && JSON.stringify(this.digests(bundle)) === JSON.stringify(parsed.data.files)
					? "current"
					: "different";
			} catch (error) {
				if (this.fs.isFileError(error, "ENOENT")) return "missing";
				if (error instanceof SyntaxError) return "different";
				throw error;
			}
		});
	}

	read(serviceId: string, resourceId: string, path: string): Promise<Uint8Array | undefined> {
		return this.serialize(serviceId, resourceId, async () => {
			if (!this.safePath(path)) return undefined;
			let current = this.root;
			try {
				const components = [serviceId, resourceId, ...path.split("/")];
				for (const [index, component] of components.entries()) {
					current = join(current, component);
					const info = await this.fs.lstat(current);
					if (index === components.length - 1 ? !info.isFile() : !info.isDirectory()) return undefined;
				}
				return new Uint8Array(await this.fs.readFileBytes(current));
			} catch (error) {
				if (this.fs.isFileError(error, "ENOENT") || this.fs.isFileError(error, "ENOTDIR")) return undefined;
				throw error;
			}
		});
	}

	private async scan(directory: string, prefix = ""): Promise<GitDirectoryFile[] | undefined> {
		if (!(await this.fs.lstat(directory)).isDirectory()) return undefined;
		const bundle: GitDirectoryFile[] = [];
		for (const entry of await this.fs.readdir(directory)) {
			const path = prefix ? `${prefix}/${entry}` : entry;
			if (!this.safePath(path)) return undefined;
			const full = join(directory, entry);
			const info = await this.fs.lstat(full);
			if (info.isFile()) bundle.push({ path, content: await this.fs.readFileBytes(full) });
			else if (info.isDirectory()) {
				const nested = await this.scan(full, path);
				if (!nested) return undefined;
				bundle.push(...nested);
			} else return undefined;
		}
		return bundle;
	}

	private digests(bundle: GitDirectoryFile[]): [string, string][] {
		return bundle
			.map(({ path, content }): [string, string] => [path, createHash("sha256").update(content).digest("hex")])
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	}

	private safePath(path: string): boolean {
		return (
			!/[\0\\]/.test(path)
			&& path.split("/").every((part) => Boolean(part) && ![".", "..", ".git"].includes(part))
		);
	}

	private serialize<T>(serviceId: string, resourceId: string, run: () => Promise<T>): Promise<T> {
		if (![serviceId, resourceId].every((id) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)))
			return Promise.reject(new StaticStoreError());
		const key = `${serviceId}/${resourceId}`;
		const result = (this.pending.get(key) ?? Promise.resolve())
			.catch(() => {})
			.then(() => (this.storage ? this.storage.use(run) : run()))
			.catch((cause: unknown) => {
				throw new StaticStoreError({ cause });
			});
		this.pending.set(key, result);
		void result
			.finally(() => {
				if (this.pending.get(key) === result) this.pending.delete(key);
			})
			.catch(() => {});
		return result;
	}
}
