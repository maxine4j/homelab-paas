import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { writeFile } from "../src/util/file.ts";
import { artifactDirectory } from "./util/git.ts";
import { waitFor } from "./util/wait.ts";

const root = resolve(import.meta.dirname, "../../..");
const id = `paas-tests-${randomUUID().slice(0, 8)}`;
const directory = await artifactDirectory(id);
const image = `${id}:local`;
const args = process.argv.slice(2);
const mode = args.shift() ?? "all";
if (!["all", "integration", "e2e"].includes(mode)) throw new Error("Expected all, integration or e2e");
const paas = process.env["PAAS_IMAGE"] ?? "homelab-paas/paas:ci";
const workload = process.env["TEST_SERVICE_IMAGE"] ?? "homelab-paas/test-service:ci";
const browser = process.env["PLAYWRIGHT_IMAGE"] ?? "homelab-paas/playwright:ci";
const envoy = "envoyproxy/envoy:v1.37.0";
const execute = promisify(execFile);
const abort = new AbortController();
let cleaning = false;
for (const signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => abort.abort(new Error(`Interrupted by ${signal}`)));

const run = (args, quiet = false) =>
	new Promise((resolve, reject) => {
		const child = spawn("docker", args, {
			cwd: root,
			stdio: quiet ? "pipe" : "inherit",
			signal: cleaning ? undefined : abort.signal,
		});
		let stderr = "";
		child.stdout?.resume();
		child.stderr?.on("data", (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-16_384);
		});
		child.on("error", reject);
		child.on("exit", (code, signal) =>
			code === 0 ? resolve() : reject(new Error(`docker ${args.at(0)} failed (${code ?? signal}): ${stderr}`)),
		);
	});

// Stream exact existing image layers into the private Engine. No test/publication rebuild.
const loadImages = () =>
	new Promise((resolve, reject) => {
		const save = spawn("docker", ["save", paas, workload, browser, envoy], {
			cwd: root,
			stdio: ["ignore", "pipe", "inherit"],
			signal: abort.signal,
		});
		const load = spawn("docker", ["exec", "-i", id, "docker", "load"], {
			cwd: root,
			stdio: ["pipe", "inherit", "inherit"],
			signal: abort.signal,
		});
		const fail = (error) => {
			save.kill();
			load.kill();
			reject(error);
		};
		save.on("error", fail);
		load.on("error", fail);
		load.stdin.on("error", fail);
		save.stdout.pipe(load.stdin);
		const completion = (child, name) =>
			new Promise((resolve, reject) =>
				child.on("exit", (code, signal) =>
					code === 0 ? resolve() : reject(new Error(`${name} failed (${code ?? signal})`)),
				),
			);
		Promise.all([completion(save, "Image export"), completion(load, "Image import")]).then(resolve, fail);
	});

let created = false;
let built = false;
const failures = [];
try {
	console.log(`Container test artifacts: ${directory}`);
	await run(["build", "-f", "services/paas/tests/fixtures/runner.Dockerfile", "-t", image, "."]);
	built = true;
	created = true;
	await run([
		"run",
		"-d",
		"--privileged",
		"--name",
		id,
		"--label",
		`homelab-paas.test-run=${id}`,
		"-e",
		"DOCKER_TLS_CERTDIR=",
		"-e",
		`PAAS_IMAGE=${paas}`,
		"-e",
		`TEST_SERVICE_IMAGE=${workload}`,
		"-e",
		`PLAYWRIGHT_IMAGE=${browser}`,
		"-v",
		`${directory}:/workspace/artifacts`,
		image,
		"dockerd",
		"--host=unix:///var/run/docker.sock",
	]);
	await waitFor(
		"private Docker Engine",
		async () => {
			await run(["exec", id, "docker", "info"], true);
			return true;
		},
		60_000,
		abort.signal,
	);
	if (mode !== "e2e") await run(["exec", id, "pnpm", "test:integration"]);
	if (mode !== "integration") {
		try {
			await run(["image", "inspect", envoy], true);
		} catch {
			await run(["pull", envoy]);
		}
		await loadImages();
		await run(["exec", id, "pnpm", "test:e2e", ...args]);
	}
} catch (error) {
	failures.push(error);
} finally {
	cleaning = true;
	const attempt = async (operation) => {
		try {
			await operation();
		} catch (error) {
			failures.push(error);
		}
	};
	if (created) {
		await attempt(async () => {
			for (const [name, args] of [
				["engine.log", ["logs", id]],
				["docker-final.txt", ["exec", id, "docker", "ps", "-a", "--no-trunc"]],
				["networks-final.txt", ["exec", id, "docker", "network", "ls"]],
			]) {
				const result = await execute("docker", args, {
					cwd: root,
					timeout: 15_000,
					maxBuffer: 16 * 1024 * 1024,
				});
				await writeFile(`${directory}/${name}`, `${result.stdout}${result.stderr}`, { mode: 0o600 });
			}
		});
		await attempt(() => run(["rm", "-fv", id]));
		// Change ownership only after every inner process has stopped writing artifacts.
		if (process.getuid && process.getgid)
			await attempt(() =>
				run([
					"run",
					"--rm",
					"--network",
					"none",
					"--label",
					`homelab-paas.test-run=${id}`,
					"--entrypoint",
					"chown",
					"-v",
					`${directory}:/artifacts`,
					image,
					"-R",
					`${process.getuid()}:${process.getgid()}`,
					"/artifacts",
				]),
			);
	}
	if (built) await attempt(() => run(["image", "rm", image]));
}
if (failures.length) throw new AggregateError(failures, "Container test run failed; diagnostics retained");
