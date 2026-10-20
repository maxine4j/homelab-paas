import { z } from "zod";

import type { KeyValueStore } from "../../store/types.ts";
import type { Endpoint } from "./types.ts";

/** Desired endpoints, including changes whose publication outcome is uncertain. */
export interface IEndpointsStore {
	getAll(): Promise<Record<string, Endpoint>>;
	set(serviceId: string, endpoint: Endpoint | undefined): Promise<void>;
}

export class EndpointsStore implements IEndpointsStore {
	constructor(private readonly store: KeyValueStore<unknown>) {}

	async getAll(): Promise<Record<string, Endpoint>> {
		try {
			const value = await this.store.get("routes");
			return routesSchema.parse(value === undefined ? {} : value);
		} catch {
			throw new Error("Cannot read reconciliation data; check platform state files and permissions");
		}
	}

	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		if (!id.safeParse(serviceId).success) throw new Error("Invalid reconciliation service identity");
		const routes = await this.getAll();
		if (endpoint) routes[serviceId] = endpoint;
		else delete routes[serviceId];
		try {
			await this.store.set("routes", routesSchema.parse(routes));
		} catch {
			throw new Error("Cannot write reconciliation data; check platform state directory permissions");
		}
	}
}
const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const routesSchema = z.record(
	id,
	z.strictObject({
		address: z.union([z.ipv4(), z.ipv6()]),
		port: z.number().int().min(1).max(65535),
		healthcheckPath: z.string().startsWith("/").default("/healthcheck"),
		public: z.boolean(),
	}),
);
