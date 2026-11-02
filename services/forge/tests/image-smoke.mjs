import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { mkdir, writeFile } from "@homelab-paas/backend-infrastructure/file";

// Tests only: inspect the real, built container through Docker, without publishing HTTP ports.
const image = process.env.FORGE_IMAGE ?? "homelab-paas/forge:dev";
const name = `forge-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const docker = (...args) =>
	execFileSync("docker", args, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const execute = (code) => docker("exec", name, "node", "--input-type=module", "-e", code);
const request = (path, options = {}) =>
	JSON.parse(
		execute(
			`const r = await fetch(${JSON.stringify(`http://127.0.0.1:8080${path}`)}, ${JSON.stringify(options)}); console.log(JSON.stringify({status:r.status, type:r.headers.get('content-type'), body:await r.text()}));`,
		),
	);
const headers = { "x-webauth-user": "owner", origin: "https://forge.example.test", "content-type": "application/json" };
const waitFor = async (probe) => {
	const deadline = Date.now() + 30_000;
	let error;
	while (Date.now() < deadline) {
		try {
			return await probe();
		} catch (cause) {
			error = cause;
			await pause(100);
		}
	}
	throw error;
};
const env = ["-e", "FORGE_OWNER=owner", "-e", "FORGE_ORIGIN=https://forge.example.test"];
let normalLogs = "";
try {
	docker("volume", "create", volume);
	docker("run", "-d", "--name", name, "--mount", `type=volume,source=${volume},target=/data`, ...env, image);
	await waitFor(() => assert.equal(request("/health").status, 200));
	const inspect = JSON.parse(docker("inspect", name))[0];
	assert.equal(inspect.Config.User, "node");
	assert.equal(Object.keys(inspect.HostConfig.PortBindings ?? {}).length, 0);
	assert.equal(request("/").status, 403);
	assert.equal(request("/", { headers }).type, "text/html; charset=utf-8");
	assert.equal(request("/api/missing", { headers }).status, 404);
	assert.equal(
		request("/api/projects", {
			method: "POST",
			headers: { ...headers, origin: "https://other.test" },
			body: '{"name":"Denied"}',
		}).status,
		403,
	);
	const created = request("/api/projects", { method: "POST", headers, body: '{"name":"Persistent project"}' });
	assert.equal(created.status, 201);
	const project = JSON.parse(created.body);
	assert.equal(project.status, "ready");
	// Real shipped CLI/protocol, no live login or credentials.
	const accounts = JSON.parse(request("/api/accounts", { headers }).body);
	assert.equal(accounts.codex.connection, "available");
	assert.equal(accounts.github.connection, "available");
	assert.equal(accounts.codex.account, undefined);
	assert.match(docker("exec", name, "./node_modules/.bin/codex", "--version"), /0\.164\.0/);
	assert.match(docker("exec", name, "gh", "auth", "login", "--help"), /--insecure-storage/);
	execute(
		`import {stat,writeFile} from '@homelab-paas/backend-infrastructure/file'; for (const path of ['/data','/data/codex','/data/github']) { const s=await stat(path); if ((s.mode & 511)!==448 || s.uid!==1000) throw Error('unsafe data permissions'); } await writeFile('/data/codex/persistence-probe','test-only',{mode:384});`,
	);
	const orphan = execute(
		`import {spawn} from 'node:child_process'; const child=spawn(process.execPath,['-e','setTimeout(()=>{},100)'],{detached:true,stdio:'ignore'}); child.unref(); console.log(child.pid);`,
	);
	await waitFor(() =>
		assert.equal(
			execute(
				`import {lstat} from '@homelab-paas/backend-infrastructure/file'; console.log(await lstat('/proc/${orphan}').then(()=>false,()=>true));`,
			),
			"true",
		),
	);
	docker("stop", "--time", "10", name);
	assert.equal(JSON.parse(docker("inspect", name))[0].State.ExitCode, 0);
	assert.doesNotMatch(docker("logs", name), /exited unsuccessfully|Forge shutting down|Codex disconnected/);
	docker("start", name);
	await waitFor(() => assert.equal(request("/health").status, 200));
	assert.equal(JSON.parse(request("/api/projects", { headers }).body)[0].id, project.id);
	assert.equal(
		execute(
			`import {readFile} from '@homelab-paas/backend-infrastructure/file'; console.log(await readFile('/data/codex/persistence-probe'));`,
		),
		"test-only",
	);
	// A broken provider home cannot withhold project HTTP, and repair recovers without another restart.
	docker("stop", "--time", "10", name);
	docker(
		"run",
		"--rm",
		"--mount",
		`type=volume,source=${volume},target=/data`,
		image,
		"node",
		"--input-type=module",
		"-e",
		"import {rename,writeFile} from '@homelab-paas/backend-infrastructure/file';await rename('/data/github','/data/github-backup');await writeFile('/data/github','test-only broken home');",
	);
	docker("start", name);
	await waitFor(() => assert.equal(request("/health").status, 200));
	assert.equal(JSON.parse(request("/api/projects", { headers }).body)[0].id, project.id);
	assert.equal(JSON.parse(request("/api/accounts", { headers }).body).github.connection, "unavailable");
	execute(
		"import {rm,rename} from '@homelab-paas/backend-infrastructure/file';await rm('/data/github');await rename('/data/github-backup','/data/github');",
	);
	assert.equal(JSON.parse(request("/api/accounts", { headers }).body).github.connection, "available");
	// Real HTTP/SQLite/lifecycle with a controlled remote-Git CLI peer; no external import or TLS bypass.
	docker("stop", "--time", "10", name);
	normalLogs = docker("logs", name);
	docker("rm", name);
	docker(
		"run",
		"-d",
		"--name",
		name,
		"--mount",
		`type=volume,source=${volume},target=/data`,
		"--mount",
		`type=bind,source=${fileURLToPath(new URL("fixtures", import.meta.url))},target=/fixtures,readonly`,
		...env,
		"-e",
		"FORGE_IMPORT_HOSTS=example.com",
		image,
		"node",
		"/fixtures/import-bootstrap.mjs",
	);
	await waitFor(() => assert.equal(request("/health").status, 200));
	const pendingRequest = spawn(
		"docker",
		[
			"exec",
			name,
			"node",
			"--input-type=module",
			"-e",
			`const r=await fetch('http://127.0.0.1:8080/api/projects',${JSON.stringify({ method: "POST", headers, body: JSON.stringify({ name: "Cancelled import", source: "https://example.com/repository.git" }) })}); console.log(r.status);`,
		],
		{ stdio: "ignore" },
	);
	const requestClosed = once(pendingRequest, "close");
	await waitFor(() =>
		assert.equal(
			execute(
				"import {readFile} from '@homelab-paas/backend-infrastructure/file';if(!await readFile('/data/slow-git.json'))process.exit(1);console.log('ready');",
			),
			"ready",
		),
	);
	docker("stop", "--time", "10", name);
	await requestClosed;
	assert.equal(JSON.parse(docker("inspect", name))[0].State.ExitCode, 0);
	docker("start", name);
	await waitFor(() => assert.equal(request("/health").status, 200));
	assert.equal(
		JSON.parse(request("/api/projects", { headers }).body).find((item) => item.name === "Cancelled import").status,
		"failed",
	);
	docker(
		"run",
		"--rm",
		...env,
		image,
		"node",
		"--input-type=module",
		"-e",
		"import {start} from './dist/start.js';import {Lifecycle} from './dist/http/lifecycle.js';const lifecycle=new Lifecycle();const started=start(lifecycle);await lifecycle.shutdown();await started;",
	);
	// Fail after opening SQLite to prove partial-startup cleanup exits promptly.
	assert.throws(
		() =>
			docker(
				"run",
				"--rm",
				...env,
				"--mount",
				"type=tmpfs,target=/app/services/forge/packages/frontend/dist",
				image,
			),
		(error) => error.status === 1,
	);
	// A real bind error follows the same fatal cleanup path.
	assert.throws(
		() =>
			docker(
				"run",
				"--rm",
				...env,
				image,
				"node",
				"--input-type=module",
				"-e",
				"import {createServer} from 'node:http';const server=createServer();server.listen(8080,'0.0.0.0',()=>import('./dist/main.js'));",
			),
		(error) => error.status === 1,
	);
	console.log(
		"Forge image smoke passed: private HTTP boundary, assets, Git/SQLite persistence, restricted nonroot data, real Codex account protocol, gh flags, tini orphan reaping, graceful signal and partial/fatal startup.",
	);
} catch (error) {
	console.error(docker("logs", name));
	throw error;
} finally {
	try {
		const directory = fileURLToPath(new URL("../../../artifacts/forge", import.meta.url));
		await mkdir(directory, { recursive: true });
		const architecture = docker("image", "inspect", "--format", "{{.Architecture}}", image);
		await writeFile(
			`${directory}/image-${architecture}.log`,
			`${docker("image", "inspect", "--format", "{{.Id}}", image)}\n${normalLogs}\n${docker("logs", name)}\n${docker("inspect", name)}`,
		);
	} finally {
		try {
			docker("rm", "-f", name);
		} finally {
			docker("volume", "rm", volume);
		}
	}
}
