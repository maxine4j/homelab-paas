import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../config/paas-config.ts";
import { testConfig } from "../util/test/config.ts";
import { DesiredInputs } from "./desired-inputs.ts";

const fixture = () => {
	const sources = { demo: { remote: "local", descriptorPath: "/repo/demo.yaml", accessToken: "one" } };
	const config = testConfig({ services: sources });
	const fetchFile = vi.fn(async () => ({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				app: {
					type: "web",
					image: "app:1",
					ingress: { public: true, port: 80 },
					env: [{ name: "TOKEN", secret: true }],
				},
			},
		}),
	}));
	const decode = vi.fn(decodeDescriptorYaml);
	const resolve = vi.fn(async () => [{ name: "TOKEN", value: "secret-one" }]);
	const inputs = new DesiredInputs(config, { fetchFile }, decode, { resolve });
	return { sources, config, fetchFile, decode, resolve, inputs };
};

test("prepares static-only and mixed resources with a shared primary and no workload fields", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				site: { type: "static", path: "/dist", ingress: { public: true } },
			},
		}),
	});
	expect((await f.inputs.read("demo")).resources).toEqual([
		["site", { type: "static", path: "/dist", ingress: { public: true }, primary: true }],
	]);
	f.fetchFile.mockResolvedValue({
		revision: "new",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				site: { type: "static", path: "/dist", primary: true },
				app: { type: "web", image: "app:1", ingress: { public: true, port: 80 } },
			},
		}),
	});
	await f.inputs.refresh("demo");
	expect((await f.inputs.read("demo")).resources).toMatchObject([
		["site", { primary: true }],
		["app", { primary: false }],
	]);
	f.config.getAuthConfig = () => undefined;
	await expect(f.inputs.refresh("demo")).rejects.toMatchObject({ stage: "capabilities" });
});

test("reuses validated resolved inputs and detects secret-only external refreshes", async () => {
	const f = fixture();
	const first = await f.inputs.read("demo");
	for (let i = 0; i < 5; i++) expect(await f.inputs.read("demo")).toEqual(first);
	expect(f.fetchFile).toHaveBeenCalledTimes(1);
	expect(f.decode).toHaveBeenCalledTimes(1);
	expect(f.resolve).toHaveBeenCalledTimes(1);
	expect(await f.inputs.refresh("demo")).toBe(false);
	expect(f.decode).toHaveBeenCalledTimes(1);
	f.resolve.mockResolvedValue([{ name: "TOKEN", value: "secret-two" }]);
	expect(await f.inputs.refresh("demo")).toBe(true);
	expect((await f.inputs.read("demo")).resources[0]?.[1]).toMatchObject({
		env: [{ name: "TOKEN", value: "secret-two" }],
	});
	const resource = first.resources[0]![1];
	if (resource.type === "static") throw new Error("Expected workload");
	resource.image = "mutated";
	expect((await f.inputs.read("demo")).resources[0]?.[1]).toMatchObject({ image: "app:1" });
});

test("isolates source/credential namespaces even at identical commit and content", async () => {
	const f = fixture();
	await f.inputs.read("demo");
	f.sources.demo.accessToken = "rotated";
	expect(await f.inputs.refresh("demo")).toBe(true);
	expect(f.decode).toHaveBeenCalledTimes(2);
	f.sources.demo.remote = "https://another/repository";
	expect(await f.inputs.refresh("demo")).toBe(true);
	expect(f.decode).toHaveBeenCalledTimes(3);
	f.config.getAuthConfig = () => undefined;
	expect(await f.inputs.refresh("demo")).toBe(true);
});

test("invalid/missing secrets discard stale success until a new refresh or retry succeeds", async () => {
	const f = fixture();
	await f.inputs.read("demo");
	f.resolve.mockRejectedValue(new Error("Cannot resolve application secrets"));
	await expect(f.inputs.refresh("demo")).rejects.toMatchObject({ stage: "secrets" });
	await expect(f.inputs.read("demo")).rejects.toMatchObject({ stage: "secrets" });
	f.resolve.mockResolvedValue([{ name: "TOKEN", value: "repaired" }]);
	expect(await f.inputs.refresh("demo")).toBe(true);
});

test("invalidation overlapping resolution cannot publish stale desired inputs", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.resolve.mockImplementationOnce(async () => {
		await blocked;
		return [{ name: "TOKEN", value: "old" }];
	});
	const read = f.inputs.read("demo");
	await vi.waitFor(() => expect(f.resolve).toHaveBeenCalledTimes(1));
	f.inputs.invalidate("demo");
	f.resolve.mockResolvedValue([{ name: "TOKEN", value: "new" }]);
	release();
	expect((await read).resources[0]?.[1]).toMatchObject({ env: [{ name: "TOKEN", value: "new" }] });
});
