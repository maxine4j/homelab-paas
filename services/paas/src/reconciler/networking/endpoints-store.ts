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
		} catch (cause) {
			throw new Error("Cannot read reconciliation data; check platform state files and permissions", { cause });
		}
	}

	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		if (!routeId.safeParse(serviceId).success) throw new Error("Invalid reconciliation service identity");
		const routes = await this.getAll();
		const service = serviceId.split(".").at(1);
		// Legacy routes have no resource identity: any recreation may retire their destination.
		if (service && !endpoint) delete routes[service];
		if (service && endpoint?.primary) {
			delete routes[service];
			for (const [key, value] of Object.entries(routes)) {
				if (key.split(".").at(1) === service && value.primary) routes[key] = { ...value, primary: false };
			}
		}
		if (endpoint) routes[serviceId] = endpoint;
		else delete routes[serviceId];
		try {
			await this.store.set("routes", routesSchema.parse(routes));
		} catch (cause) {
			throw new Error("Cannot write reconciliation data; check platform state directory permissions", { cause });
		}
	}
}
const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const routeId = z.string().refine((value) => {
	const parts = value.split(".");
	return parts.length <= 2 && parts.every((part) => id.safeParse(part).success);
});
const routesSchema = z.record(
	routeId,
	z.strictObject({
		address: z.union([z.ipv4(), z.ipv6()]),
		port: z.number().int().min(1).max(65535),
		healthcheckPath: z.string().startsWith("/").default("/healthcheck"),
		public: z.boolean(),
		primary: z.boolean().optional(),
	}),
);
