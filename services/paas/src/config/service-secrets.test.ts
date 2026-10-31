import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { decodeDescriptorYaml } from "./paas-config.ts";
import { SecretStore } from "./secret-store.ts";
import { ServiceSecrets } from "./service-secrets.ts";

const fixture = () => {
	let content = "TOKEN=private-token\nEXTRA=private-extra\n";
	const write = vi.fn(async (_path: string, value: string | Uint8Array) => {
		content = String(value);
	});
	const fetchFile = vi.fn(async () => ({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				app: {
					type: "web",
					image: "app:1",
					ingress: { port: 8080 },
					env: [
						{ name: "TOKEN", secret: true },
						{ name: "MISSING", secret: true },
						{ name: "PLAIN", value: "literal" },
					],
				},
			},
		}),
	}));
	return {
		write,
		fetchFile,
		service: new ServiceSecrets(
			testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/app.yaml" } } }),
			{ fetchFile },
			decodeDescriptorYaml,
			new SecretStore("/env", async () => content, write),
		),
	};
};

test("returns declared names/status first and saved extras last without secret values", async () => {
	const f = fixture();
	const result = await f.service.read("demo");
	expect(result.variables).toEqual([
		{ name: "MISSING", configured: false, used: true },
		{ name: "TOKEN", configured: true, used: true },
		{ name: "EXTRA", configured: true, used: false },
	]);
	expect(JSON.stringify(result)).not.toContain("private-");
	const next = await f.service.update("demo", {
		revision: result.revision,
		changes: [{ name: "MISSING", value: "new-value" }],
	});
	expect(next.variables.at(0)).toEqual({ name: "MISSING", configured: true, used: true });
	expect(JSON.stringify(next)).not.toContain("private-");
});

test("clearing a declared secret marks it missing and clearing an unused secret removes its row", async () => {
	const f = fixture();
	const current = await f.service.read("demo");
	const next = await f.service.update("demo", {
		revision: current.revision,
		changes: [
			{ name: "TOKEN", value: "" },
			{ name: "EXTRA", value: "" },
		],
	});
	expect(next.variables).toEqual([
		{ name: "MISSING", configured: false, used: true },
		{ name: "TOKEN", configured: false, used: true },
	]);
	expect(f.write).toHaveBeenCalledWith("/env/demo.env", "", { mode: 0o600 });
});

test("rejects invalid/unconfigured identities before accessing secrets or Git", async () => {
	const f = fixture();
	for (const id of ["../demo", "toString", "other"])
		await expect(f.service.read(id)).rejects.toMatchObject({ kind: "not-found" });
	expect(f.fetchFile).not.toHaveBeenCalled();
});

test("descriptor updates conflict and descriptor failures never echo source content", async () => {
	const f = fixture();
	const current = await f.service.read("demo");
	f.fetchFile.mockResolvedValue({ revision: "other", content: (await f.fetchFile()).content });
	await expect(
		f.service.update("demo", { revision: current.revision, changes: [{ name: "TOKEN", value: "new-private" }] }),
	).rejects.toMatchObject({ kind: "conflict" });
	expect(f.write).not.toHaveBeenCalled();
	f.fetchFile.mockRejectedValue(new Error("private-token"));
	try {
		await f.service.read("demo");
	} catch (error) {
		expect(error).toHaveProperty("cause");
		expect(String(error)).not.toContain("private-token");
	}
});
