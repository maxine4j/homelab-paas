import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import yaml from "yaml";
import { z } from "zod";

import type { IEndpointsStore } from "./networking/endpoints-store.ts";
import type { Endpoint } from "./networking/types.ts";
import type { IReconciliationStateStore, ReconciliationState } from "./types.ts";

export class FileReconciliationStore implements IReconciliationStateStore, IEndpointsStore {
	constructor(private readonly directory: string) {}
	async read(serviceId: string): Promise<ReconciliationState | undefined> {
		return this.readValue(`${this.identity(serviceId)}.state.yaml`, stateSchema);
	}
	async write(serviceId: string, state: ReconciliationState): Promise<void> {
		await this.atomic(`${this.identity(serviceId)}.state.yaml`, stateSchema.parse(state));
	}
	async getAll(): Promise<Record<string, Endpoint>> {
		return (await this.readValue("routes.yaml", routesSchema)) ?? {};
	}
	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		this.identity(serviceId);
		const routes = await this.getAll();
		if (endpoint) routes[serviceId] = endpoint;
		else delete routes[serviceId];
		await this.atomic("routes.yaml", routesSchema.parse(routes));
	}

	private identity(serviceId: string): string {
		if (!id.safeParse(serviceId).success) throw new Error("Invalid reconciliation service identity");
		return serviceId;
	}

	private async readValue<T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> {
		try {
			return schema.parse(yaml.parse(await readFile(join(this.directory, name), "utf8")));
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw new Error("Cannot read reconciliation data; check platform state files and permissions");
		}
	}

	private async atomic(name: string, value: unknown): Promise<void> {
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const target = join(this.directory, name);
			await writeFile(`${target}.tmp`, yaml.stringify(value), { mode: 0o600 });
			await rename(`${target}.tmp`, target);
		} catch {
			throw new Error("Cannot write reconciliation data; check platform state directory permissions");
		}
	}
}

const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const stateSchema = z.strictObject({
	desiredRevision: z.string().optional(),
	activeRevision: z.string().optional(),
	phase: z
		.enum(["pending", "deploying", "ready", "failed"])
		.transform((phase) => (phase === "pending" ? ("deploying" as const) : phase)),
	error: z.string().optional(),
	failures: z.number().int().nonnegative().max(1024).optional(),
	retryAt: z.number().finite().nonnegative().optional(),
});
const routesSchema = z.record(
	id,
	z.strictObject({
		address: z.union([z.ipv4(), z.ipv6()]),
		port: z.number().int().min(1).max(65535),
		healthcheckPath: z.string().startsWith("/").default("/healthcheck"),
		public: z.boolean(),
	}),
);
