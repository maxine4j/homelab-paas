import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { PlatformConfig } from "../../src/config/types.ts";
import { JwtClient } from "../../src/ingress/auth/jwt-client.ts";
import { mkdir, readFile, writeFile } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";
import { MockGitHub } from "../mocks/github.ts";
import { artifactDirectory, TestGit } from "./git.ts";
import { ImageRetention } from "./image-retention.ts";
import { ingressPorts } from "./ports.ts";
import { createTls, seedTls } from "./tls.ts";
import { waitFor } from "./wait.ts";

const execute = promisify(execFile);
const fixtures = resolve(import.meta.dirname, "../fixtures");
const root = resolve(import.meta.dirname, "../../../..");

/** One test owns one cluster, bare Git remote, state directory and OAuth server. */
export class ContainerEnvironment {
	readonly cluster = `e2e-${randomUUID().slice(0, 8)}`;
	readonly github = new MockGitHub();
	readonly image = process.env["TEST_SERVICE_IMAGE"] ?? "homelab-paas/test-service:ci";
	readonly paasImage = process.env["PAAS_IMAGE"] ?? "homelab-paas/paas:ci";
	directory = "";
	git!: TestGit;
	config!: PlatformConfig;
	ca = "";
	caPath = "";
	private composeEnvironment: NodeJS.ProcessEnv = {};
	private readonly descriptions: Record<string, string> = {};
	private browserContainer: string | undefined;

	async start(production = false): Promise<void> {
		this.directory = await artifactDirectory(this.cluster);
		this.git = new TestGit(this.directory);
		await this.git.init();
		await this.github.server.listen();
		// Keep image bytes in use; global setup resolved IDs because prune can remove tags.
		await new ImageRetention(this.cluster, (args) => this.docker(args)).retain([
			this.paasImage,
			this.image,
			process.env["PLAYWRIGHT_IMAGE"] ?? "homelab-paas/playwright:ci",
			"envoyproxy/envoy:v1.37.0",
		]);
		this.config = parseYaml((await readFile(join(fixtures, "config.yaml")))!, "test config") as PlatformConfig;
		this.config.metadata.clusterId = this.cluster;
		this.config.ingress.baseDomain = `${this.cluster}.paas.test`;
		[this.config.ingress.httpPort, this.config.ingress.httpsPort] = await ingressPorts();
		for (const service of ["public", "private", "second"]) {
			this.config.services[service] = {
				remote: this.git.remote,
				branch: "main",
				descriptorPath: `${service}.sd.yaml`,
			};
			this.descriptions[`${service}.sd.yaml`] = await this.descriptor(service, "v1");
		}
		await this.git.commit(this.descriptions);
		await mkdir(`${this.directory}/etc`, { recursive: true, mode: 0o700 });
		await writeFile(`${this.directory}/etc/config.yaml`, stringifyYaml(this.config), { mode: 0o600 });
		await writeFile(`${this.directory}/etc/envoy.yaml`, (await readFile(join(fixtures, "envoy.yaml")))!, {
			mode: 0o600,
		});
		const tls = await createTls(
			`${this.directory}/tls`,
			this.config.ingress.baseDomain,
			Object.keys(this.config.services),
		);
		this.ca = tls.ca;
		this.caPath = tls.caPath;
		await seedTls(`${this.directory}/var/_paas`, tls, "/var/homelab-paas/_paas");
		this.composeEnvironment = {
			...process.env,
			PAAS_IMAGE: this.paasImage,
			TEST_CLUSTER: this.cluster,
			TEST_DIRECTORY: this.directory,
			TEST_HTTP_PORT: String(this.config.ingress.httpPort),
			TEST_HTTPS_PORT: String(this.config.ingress.httpsPort),
		};
		if (!production) {
			const origin = this.github.server.url.replace("127.0.0.1", "host.docker.internal");
			await writeFile(
				`${this.directory}/override.yaml`,
				stringifyYaml({
					services: {
						paas: {
							command: ["node", "tests/bootstrap.mjs"],
							volumes: [
								`${resolve(import.meta.dirname, "../bootstrap.mjs")}:/app/services/paas/tests/bootstrap.mjs:ro`,
							],
							environment: { MOCK_GITHUB_ORIGIN: origin, MOCK_GITHUB_BROWSER_ORIGIN: origin },
						},
					},
				}),
				{ mode: 0o600 },
			);
		}
		await this.compose(["up", "-d"]);
		await this.waitReady("public", "v1");
		for (const service of ["private", "second"])
			await waitFor(
				`${service} ready checkpoint`,
				async () => (await this.checkpoint(service))?.phase === "ready",
			);
	}

	url(service: string, path = "/"): string {
		return `https://${service ? `${service}.` : ""}${this.config.ingress.baseDomain}:${this.config.ingress.httpsPort}${path}`;
	}

	session(userId = "Alice", now = Date.now()): string {
		return new JwtClient(testConfig(this.config), () => now).issue({ userId }, "session");
	}

	async descriptor(serviceId: string, version: string, strategy = "recreate", ready = true): Promise<string> {
		const value = parseYaml((await readFile(join(fixtures, "service.sd.yaml")))!, "test descriptor") as {
			metadata: { serviceId: string };
			resources: {
				app: {
					image: string;
					ingress: { public: boolean };
					rolloutStrategy?: string;
					env: { name: string; value: string }[];
				};
			};
		};
		value.metadata.serviceId = serviceId;
		value.resources.app.image = this.image;
		value.resources.app.ingress.public = serviceId === "public";
		value.resources.app.rolloutStrategy = strategy;
		value.resources.app.env = [
			{ name: "VERSION", value: version },
			{ name: "READY", value: String(ready) },
		];
		return stringifyYaml(value);
	}

	async update(service: string, version: string, strategy = "recreate", ready = true): Promise<string> {
		this.descriptions[`${service}.sd.yaml`] = await this.descriptor(service, version, strategy, ready);
		return this.git.commit(this.descriptions);
	}

	async checkpoint(
		service: string,
	): Promise<{ phase: string; activeRevision?: string; desiredRevision?: string; failures?: number } | undefined> {
		const value = await readFile(`${this.directory}/var/_paas/${service}.state.yaml`);
		return value
			? (parseYaml(value, "test checkpoint") as {
					phase: string;
					activeRevision?: string;
					desiredRevision?: string;
					failures?: number;
				})
			: undefined;
	}

	async waitReady(service: string, version: string): Promise<void> {
		await waitFor(`${service} serving ${version} through trusted HTTPS`, async () => {
			const response = await this.request(
				this.url(service, "/version"),
				`__Secure-paas_session=${this.session()}`,
			);
			return (
				response.status === 200
				&& (await response.json()).version === version
				&& (await this.checkpoint(service))?.phase === "ready"
			);
		});
	}

	/** Verify the CA and original DNS hostname while connecting to loopback ingress. */
	request(
		url: string,
		cookie = "",
		options: { method?: "GET" | "POST"; headers?: Record<string, string> } = {},
	): Promise<Response> {
		return new Promise((resolve, reject) => {
			const req = httpsRequest(
				url,
				{
					ca: this.ca,
					method: options.method ?? "GET",
					family: 4,
					lookup: (_host, _options, callback) => callback(null, "127.0.0.1", 4),
					headers: { cookie, ...options.headers },
					timeout: 5000,
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("error", reject);
					res.on("end", () => {
						const headers = new Headers();
						for (const [key, value] of Object.entries(res.headers))
							for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
								headers.append(key, item);
						resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
					});
				},
			);
			req.on("timeout", () => req.destroy(new Error(`HTTPS observation timed out: ${url}`)));
			req.on("error", reject);
			req.end();
		});
	}

	async workloadIds(service: string): Promise<string[]> {
		return (
			await this.docker([
				"ps",
				"-aq",
				"--filter",
				`label=homelab-paas.cluster=${this.cluster}`,
				"--filter",
				`label=homelab-paas.service=${service}`,
			])
		)
			.trim()
			.split("\n")
			.filter(Boolean);
	}

	async compose(args: string[]): Promise<string> {
		const files = ["-f", join(fixtures, "compose.yaml")];
		if (await readFile(`${this.directory}/override.yaml`)) files.push("-f", `${this.directory}/override.yaml`);
		return this.docker(["compose", "-p", this.cluster, ...files, ...args], this.composeEnvironment);
	}

	async docker(args: string[], env = process.env): Promise<string> {
		return (await execute("docker", args, { cwd: root, env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }))
			.stdout;
	}

	async startBrowser(): Promise<string> {
		const envoy = (await this.compose(["ps", "-q", "envoy"])).trim();
		const address = (
			await this.docker([
				"inspect",
				"--format",
				`{{(index .NetworkSettings.Networks "${this.cluster}_default").IPAddress}}`,
				envoy,
			])
		).trim();
		this.browserContainer = `${this.cluster}-browser`;
		await this.docker([
			"run",
			"-d",
			"--init",
			"--name",
			this.browserContainer,
			"--label",
			`homelab-paas.cluster=${this.cluster}`,
			"--network",
			`${this.cluster}_default`,
			"--add-host",
			"host.docker.internal:host-gateway",
			"--shm-size",
			"256m",
			"-p",
			"127.0.0.1::3000",
			"-v",
			`${root}:${root}:ro`,
			"-v",
			`${this.directory}:/test-state:ro`,
			"-e",
			`TEST_DOMAIN=${this.config.ingress.baseDomain}`,
			"-e",
			`ENVOY_ADDRESS=${address}`,
			process.env["PLAYWRIGHT_IMAGE"] ?? "homelab-paas/playwright:ci",
			"node",
			resolve(import.meta.dirname, "browser-server.mjs"),
		]);
		const endpoint = await waitFor("trusted Chromium browser server", async () => {
			const logs = await this.docker(["logs", this.browserContainer!]);
			return logs.match(/ws:\/\/[^\s]+/)?.at(0);
		});
		const port = (await this.docker(["port", this.browserContainer, "3000/tcp"])).trim().split(":").at(-1);
		const url = new URL(endpoint);
		url.hostname = "127.0.0.1";
		url.port = port!;
		return url.href;
	}

	async close(): Promise<void> {
		// Compose does not own workloads or service networks. Remove only this cluster's objects.
		const failures: unknown[] = [];
		const attempt = async (operation: () => Promise<unknown>) => {
			try {
				await operation();
			} catch (error) {
				failures.push(error);
			}
		};
		await attempt(() => this.compose(["stop", "paas"]));
		const containers = (await this.docker(["ps", "-aq", "--filter", `label=homelab-paas.cluster=${this.cluster}`]))
			.trim()
			.split("\n")
			.filter(Boolean);
		if (containers.length) await attempt(() => this.docker(["rm", "-f", ...containers]));
		await attempt(() => this.compose(["down", "--remove-orphans"]));
		const networks = (
			await this.docker(["network", "ls", "-q", "--filter", `label=homelab-paas.cluster=${this.cluster}`])
		)
			.trim()
			.split("\n")
			.filter(Boolean);
		if (networks.length) await attempt(() => this.docker(["network", "rm", ...networks]));
		// Image IDs are shared test inputs; keep their bytes available for later tests.
		await attempt(() => this.github.server.close());
		if (failures.length) throw new AggregateError(failures, "Test cluster cleanup failed");
	}
}
