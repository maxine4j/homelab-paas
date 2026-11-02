import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../config/paas-config.ts";
import { gitRepositoryKey } from "../git/git-cache-key.ts";
import { testConfig } from "../util/test/config.ts";
import { InternalCleanup } from "./internal-cleanup.ts";
import type { InternalRetention } from "./types.ts";

test("retains current repositories and desired or still-routed static bundles; descriptor failure preserves bundles", async () => {
	const source = { remote: "https://example.test/repo", descriptorPath: "demo.sd.yaml" };
	let services = { demo: source, unavailable: source };
	let retention: InternalRetention | undefined;
	const cleanup = new InternalCleanup(
		{ getServices: () => services },
		{
			fetchFile: vi.fn(async (id) => {
				if (id === "unavailable") throw new Error("offline");
				return {
					revision: "a".repeat(40),
					content:
						"version: 1\nmetadata:\n  serviceId: demo\nresources:\n  desired:\n    type: static\n    path: dist\n",
				};
			}),
		},
		decodeDescriptorYaml,
		{
			pruneServices: vi.fn(async () => ({
				routes: { "live.demo": { address: "127.0.0.1", port: 8081, public: true, static: true } },
				generation: 0,
			})),
			isCurrent: () => true,
		},
		{
			cleanup: vi.fn(async (retain) => {
				retention = retain();
			}),
		},
		() => 1000,
	);
	await cleanup.run();
	expect(retention?.git).toEqual(new Set([gitRepositoryKey(source)]));
	expect(retention?.static?.get("demo")).toEqual(new Set(["desired", "live"]));
	expect(retention?.static?.has("unavailable")).toBe(false);
});

test("rechecks accepted config during filesystem cleanup and preserves publications after a source change", async () => {
	let services = testConfig().getServices();
	const source = { remote: "https://example.test/repo", descriptorPath: "demo.sd.yaml" };
	services = { demo: source };
	let retention: InternalRetention | undefined;
	const cleanup = new InternalCleanup(
		{ getServices: () => services },
		{
			fetchFile: async () => ({
				revision: "a".repeat(40),
				content:
					"version: 1\nmetadata:\n  serviceId: demo\nresources:\n  site:\n    type: static\n    path: dist\n",
			}),
		},
		decodeDescriptorYaml,
		{ pruneServices: async () => ({ routes: {}, generation: 0 }), isCurrent: () => true },
		{
			cleanup: async (retain) => {
				services = { demo: { ...source, branch: "new" } };
				retention = retain();
			},
		},
		() => 1000,
	);
	await cleanup.run();
	expect(retention?.git).toEqual(new Set([gitRepositoryKey(services["demo"]!)]));
	expect(retention?.static?.has("demo")).toBe(false);
});
