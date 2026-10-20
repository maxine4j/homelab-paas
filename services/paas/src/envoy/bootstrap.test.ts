import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { mkdtemp, readFile, rm, stat, writeFile } from "../util/file.ts";
import { parseYaml } from "../util/yaml.ts";
import { EnvoyClient } from "./envoy-client.ts";
import { EnvoyService } from "./envoy-service.ts";
import { NodeEnvoyTransport } from "./envoy-transport.ts";
import { EnvoyClientError } from "./types.ts";

const bootstrap = (directory: string): Promise<void> =>
	new EnvoyService(
		new EnvoyClient(
			new NodeEnvoyTransport({ directory, adminUrl: "http://127.0.0.1:1", timeoutMs: 1, maxResponseBytes: 1 }),
			async () => {},
			{ attempts: 1, intervalMs: 0 },
		),
		{ baseDomain: "example.test", httpPort: 80 },
	).bootstrap();

test("first startup creates restricted state storage and empty Envoy discovery files", async () => {
	const root = await mkdtemp(join(tmpdir(), "paas-bootstrap-"));
	try {
		const directory = join(root, "state");
		await bootstrap(directory);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		for (const name of ["cds.yaml", "lds.yaml"]) {
			const file = join(directory, name);
			expect(parseYaml((await readFile(file)) ?? "", file)).toEqual({ version_info: "bootstrap", resources: [] });
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
		expect(await readFile(join(directory, "cds.yaml"))).toBe("existing clusters");
		expect(await readFile(join(directory, "routes.yaml"))).toBe("existing routes");
		expect(await readFile(join(directory, "demo.state.yaml"))).toBe("existing checkpoint");
		expect(parseYaml((await readFile(join(directory, "lds.yaml"))) ?? "", "lds.yaml")).toMatchObject({
			resources: [],
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("fails startup when state storage cannot be prepared", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-bootstrap-"));
	try {
		const file = join(directory, "file");
		await writeFile(file, "existing");
		await expect(bootstrap(file)).rejects.toThrow(EnvoyClientError);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
