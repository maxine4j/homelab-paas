import { expect, test } from "vitest";

import type { IEnvoyService } from "../../envoy/envoy-service.ts";
import { InMemoryKeyValueStore } from "../../store/in-memory-store.ts";
import { EndpointsStore } from "./endpoints-store.ts";
import { NetworkingError, NetworkingService } from "./networking-service.ts";
import type { Endpoint } from "./types.ts";

const old: Endpoint = { address: "10.0.0.1", port: 8080, healthcheckPath: "/ready", public: true };
const replacement: Endpoint = { ...old, address: "10.0.0.2" };

function fixture() {
	const snapshots: Record<string, Endpoint>[] = [];
	const endpoints = new EndpointsStore(new InMemoryKeyValueStore<unknown>());
	const envoy: IEnvoyService = {
		async bootstrap() {},
		async configureRoutes(routes) {
			snapshots.push(routes);
		},
	};
	return { endpoints, envoy, snapshots, service: new NetworkingService(endpoints, envoy) };
}

test("switches containers and withdraws a service while preserving other services", async () => {
	const f = fixture();
	await f.service.routeTo("other", old);
	await f.service.routeTo("demo", old);
	await f.service.routeTo("demo", replacement);
	await f.service.withdraw("demo");
	expect(f.snapshots.at(-2)).toEqual({ other: old, demo: replacement });
	expect(f.snapshots.at(-1)).toEqual({ other: old });
	expect(await f.endpoints.getAll()).toEqual({ other: old });
});

test("does not resolve or publish a concurrent snapshot before acceptance", async () => {
	const f = fixture();
	let release: () => void = () => {};
	const accepted = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered: () => void = () => {};
	const publishing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	f.envoy.configureRoutes = async (routes) => {
		f.snapshots.push(routes);
		if (f.snapshots.length === 1) {
			entered();
			await accepted;
		}
	};
	let resolved = false;
	const first = f.service.routeTo("demo", old).then(() => {
		resolved = true;
	});
	await publishing;
	const second = f.service.routeTo("other", replacement);
	expect(resolved).toBe(false);
	expect(f.snapshots).toHaveLength(1);
	release();
	await Promise.all([first, second]);
	expect(f.snapshots.at(-1)).toEqual({ demo: old, other: replacement });
});

test("preserves desired endpoints after uncertain publication and retries after failure", async () => {
	const f = fixture();
	f.envoy.configureRoutes = async () => {
		throw new Error("sensitive infrastructure detail");
	};
	await expect(f.service.routeTo("demo", replacement)).rejects.toThrow(NetworkingError);
	expect(await f.endpoints.getAll()).toEqual({ demo: replacement });
	f.envoy.configureRoutes = async (routes) => {
		f.snapshots.push(routes);
	};
	await f.service.routeTo("demo", replacement);
	expect(f.snapshots).toEqual([{ demo: replacement }]);
});

test("store failure prevents publication", async () => {
	const f = fixture();
	f.endpoints.set = async () => {
		throw new Error("storage failed");
	};
	await expect(f.service.routeTo("demo", old)).rejects.toThrow(NetworkingError);
	expect(f.snapshots).toEqual([]);
});

test("endpoint snapshots and supplied objects cannot mutate stored state", async () => {
	const f = fixture();
	const endpoint = { ...old };
	const publication = f.service.routeTo("demo", endpoint);
	endpoint.address = "changed";
	await publication;
	const snapshot = await f.endpoints.getAll();
	const stored = snapshot["demo"];
	if (stored) stored.address = "changed";
	expect(await f.endpoints.getAll()).toEqual({ demo: old });
});
