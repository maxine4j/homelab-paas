import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";
import yaml from "yaml";

import { bootstrap } from "./bootstrap.ts";

test("first startup creates restricted state storage and empty Envoy discovery files", async () => {
	const root = await mkdtemp(join(tmpdir(), "paas-bootstrap-"));
	try {
		const directory = join(root, "state");
		await bootstrap(directory);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		for (const name of ["cds.yaml", "lds.yaml"]) {
			const file = join(directory, name);
			expect(yaml.parse(await readFile(file, "utf8"))).toEqual({ version_info: "bootstrap", resources: [] });
			expect((await stat(file)).mode & 0o777).toBe(0o600);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("subsequent startup preserves discovery files and persisted platform state", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-bootstrap-"));
	try {
		await writeFile(join(directory, "cds.yaml"), "existing clusters");
		await writeFile(join(directory, "routes.yaml"), "existing routes");
		await writeFile(join(directory, "demo.state.yaml"), "existing checkpoint");
		await bootstrap(directory);
		await bootstrap(directory);
		expect(await readFile(join(directory, "cds.yaml"), "utf8")).toBe("existing clusters");
		expect(await readFile(join(directory, "routes.yaml"), "utf8")).toBe("existing routes");
		expect(await readFile(join(directory, "demo.state.yaml"), "utf8")).toBe("existing checkpoint");
		expect(yaml.parse(await readFile(join(directory, "lds.yaml"), "utf8"))).toMatchObject({ resources: [] });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("fails startup when state storage cannot be prepared", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-bootstrap-"));
	try {
		const file = join(directory, "file");
		await writeFile(file, "existing");
		await expect(bootstrap(file)).rejects.toThrow("Cannot bootstrap platform state");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
