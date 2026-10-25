import { writeFile, readFile } from "../../src/util/file.ts";
import type { ContainerEnvironment } from "./container-environment.ts";

/** Called before cleanup on every outcome, including partial startup failures. */
export const captureDiagnostics = async (environment: ContainerEnvironment): Promise<void> => {
	if (!environment.directory) return;
	const commands: [string, () => Promise<string>][] = [
		["compose.log", () => environment.compose(["logs", "--no-color", "--timestamps"])],
		[
			"docker.txt",
			() =>
				environment.docker([
					"ps",
					"-a",
					"--no-trunc",
					"--filter",
					`label=homelab-paas.cluster=${environment.cluster}`,
				]),
		],
		[
			"networks.json",
			() =>
				environment.docker([
					"network",
					"ls",
					"--filter",
					`label=homelab-paas.cluster=${environment.cluster}`,
					"--format",
					"json",
				]),
		],
		[
			"xds.json",
			() =>
				environment.compose([
					"exec",
					"-T",
					"paas",
					"node",
					"-e",
					"fetch('http://envoy:9901/config_dump').then(r=>r.text()).then(console.log)",
				]),
		],
		["mock-github.json", async () => JSON.stringify(environment.github.server.requests, undefined, 2)],
		[
			"containers.json",
			async () => {
				const ids = (
					await environment.docker([
						"ps",
						"-aq",
						"--filter",
						`label=homelab-paas.cluster=${environment.cluster}`,
					])
				)
					.trim()
					.split("\n")
					.filter(Boolean);
				return ids.length ? environment.docker(["inspect", ...ids]) : "[]";
			},
		],
		[
			"workloads.log",
			async () => {
				const ids = (
					await environment.docker([
						"ps",
						"-aq",
						"--filter",
						`label=homelab-paas.cluster=${environment.cluster}`,
					])
				)
					.trim()
					.split("\n")
					.filter(Boolean);
				const logs: string[] = [];
				for (const id of ids) logs.push(`${id}\n${await environment.docker(["logs", "--timestamps", id])}`);
				return logs.join("\n");
			},
		],
	];
	for (const [name, read] of commands) {
		let content: string;
		try {
			content = await read();
		} catch (error) {
			content = String(error);
		}
		await writeFile(`${environment.directory}/${name}`, content, { mode: 0o600 });
	}
	// Checkpoints and discovery bytes already live in this retained artifact directory.
	await writeFile(
		`${environment.directory}/diagnostics.txt`,
		`Cluster: ${environment.cluster}\n${(await readFile(`${environment.directory}/var/_paas/routes.yaml`)) ?? "No routes published"}`,
		{ mode: 0o600 },
	);
};
