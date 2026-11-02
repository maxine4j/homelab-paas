import { z } from "zod";

import type { KeyValueStore } from "../../store/types.ts";
import type { IReconciliationStateStore } from "../types.ts";
import type { Endpoint } from "./types.ts";

/** Desired endpoints, including changes whose publication outcome is uncertain. */
export interface IEndpointsStore {
	/** Effective routes exclude paused services; pause-state read failures reject the whole snapshot. */
	getAll(): Promise<Record<string, Endpoint>>;
	/** Undefined withdraws one resource, or all routes when given a bare service identity. */
	set(serviceId: string, endpoint: Endpoint | undefined): Promise<void>;
}

export class EndpointsStore implements IEndpointsStore {
	constructor(
		private readonly store: KeyValueStore<unknown>,
		private readonly listServices: () => Promise<string[]>,
		private readonly state?: IReconciliationStateStore,
	) {}

	async getAll(): Promise<Record<string, Endpoint>> {
		try {
			const routes: Record<string, Endpoint> = {};
			for (const service of await this.listServices()) {
				if ((await this.state?.read(service))?.paused) continue;
				Object.assign(routes, await this.readService(service));
			}
			return routes;
		} catch (cause) {
			throw new Error("Cannot read reconciliation data; check platform state files and permissions", { cause });
		}
	}

	async set(serviceId: string, endpoint: Endpoint | undefined): Promise<void> {
		if (!routeId.safeParse(serviceId).success) throw new Error("Invalid reconciliation service identity");
		const owner = serviceId.split(".").at(-1)!;
		let routes: Record<string, Endpoint>;
		try {
			routes = await this.readService(owner);
		} catch (cause) {
			throw new Error("Cannot read reconciliation data; check platform state files and permissions", { cause });
		}
		const previous = JSON.stringify(routes);
		const service = serviceId.split(".").at(1);
		if (!service && !endpoint) routes = {};
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
			const next = routesSchema.parse(routes);
			if (JSON.stringify(next) === previous) return;
			await this.store.set(`${owner}.routes`, next);
		} catch (cause) {
			throw new Error("Cannot write reconciliation data; check platform state directory permissions", { cause });
		}
	}
	private async readService(service: string): Promise<Record<string, Endpoint>> {
		if (!id.safeParse(service).success) throw new Error("Invalid route owner");
		const value = await this.store.get(`${service}.routes`);
		const routes = routesSchema.parse(value === undefined ? {} : value);
		if (Object.keys(routes).some((route) => route.split(".").at(-1) !== service))
			throw new Error("Route belongs to another service");
		return routes;
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
		static: z.boolean().optional(),
		address: z.union([z.ipv4(), z.ipv6()]),
		port: z.number().int().min(1).max(65535),
		healthcheckPath: z.string().startsWith("/").nullish(),
		public: z.boolean(),
		primary: z.boolean().optional(),
	}),
);
