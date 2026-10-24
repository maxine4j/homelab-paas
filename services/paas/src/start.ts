import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import acme from "acme-client";
import Koa from "koa";
import { nanoid } from "nanoid";

import { PaasConfig, decodeDescriptorYaml } from "./config/paas-config.ts";
import { DockerClient } from "./docker/docker-client.ts";
import { DockerService } from "./docker/docker-service.ts";
import { NodeDockerTransport } from "./docker/docker-transport.ts";
import { EnvoyClient } from "./envoy/envoy-client.ts";
import { EnvoyService } from "./envoy/envoy-service.ts";
import { NodeEnvoyTransport } from "./envoy/envoy-transport.ts";
import { createFrontendRouter } from "./frontend/frontend-router.ts";
import { FrontendService } from "./frontend/frontend-service.ts";
import { DirectoryUiFiles } from "./frontend/frontend-store.ts";
import { createPaasUiRouter } from "./frontend/paas-ui-router.ts";
import { PaasUiService } from "./frontend/paas-ui-service.ts";
import { GitClient } from "./git/git-client.ts";
import { GitService } from "./git/git-service.ts";
import { NodeGitTransport } from "./git/git-transport.ts";
import { createAuthRouter } from "./ingress/auth/auth-router.ts";
import { AuthService } from "./ingress/auth/auth-service.ts";
import { JwtClient } from "./ingress/auth/jwt-client.ts";
import { GitHubOauth2Provider } from "./ingress/auth/oauth-provider/github.ts";
import { AcmeAccountStore } from "./ingress/tls/acme-account-store.ts";
import { AcmeClient } from "./ingress/tls/acme-client.ts";
import { TlsCertProvisionService } from "./ingress/tls/cert-provision-service.ts";
import { TlsCertRenewalTask } from "./ingress/tls/cert-renewal-task.ts";
import { FileCertificateStore } from "./ingress/tls/certificate-store.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "./ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";
import { DeploymentService } from "./reconciler/deployment/deployment-service.ts";
import { RecreateDeploymentStrategy } from "./reconciler/deployment/strategy/recreate-deployment-strategy.ts";
import { SurgeDeploymentStrategy } from "./reconciler/deployment/strategy/surge-deployment-strategy.ts";
import { EnvironmentResolver } from "./reconciler/environment-resolver.ts";
import { EndpointsStore } from "./reconciler/networking/endpoints-store.ts";
import { NetworkingService } from "./reconciler/networking/networking-service.ts";
import { ReconcilerService } from "./reconciler/reconciler-service.ts";
import { ReconcilerTask } from "./reconciler/reconciler-task.ts";
import { ReconciliationStore } from "./reconciler/reconciliation-store.ts";
import { WebResourceReconciler } from "./reconciler/resources/web/web-reconciler.ts";
import { FileSystemKeyValueStore } from "./store/file-system-store.ts";
import { PeriodicTaskRunner } from "./task/periodic.ts";
import { atomicWriteFile, lstat, mkdir, readFileBytes, readFile, rm, type FileWriter } from "./util/file.ts";
import { createHealthCheckRouter, probe } from "./util/healthcheck.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { createRequestLogger, logger, withLogContext } from "./util/logger.ts";
import { sleep } from "./util/sleep.ts";

const STATE_DIRECTORY = "/var/homelab-paas/_paas";

export async function start(lifecycle: Lifecycle): Promise<void> {
	const config = await new PaasConfig(readFile, process.env).load();
	const secureWrite: FileWriter = async (path, content) => {
		await mkdir(STATE_DIRECTORY, { recursive: true, mode: 0o700 });
		await atomicWriteFile(path, content, { mode: 0o600 });
	};
	const remove = async (path: string): Promise<void> => {
		await rm(path, { force: true });
	};
	const state = new FileSystemKeyValueStore<unknown>(STATE_DIRECTORY, readFile, secureWrite, remove, "yaml");
	const store = new ReconciliationStore(state);
	const endpoints = new EndpointsStore(state);
	const docker = new DockerService(
		new DockerClient(
			new NodeDockerTransport(
				{
					socketPath: "/var/run/docker.sock",
					timeoutMs: 120_000,
					maxResponseBytes: 16 * 1024 * 1024,
				},
				sleep,
			),
		),
		config.metadata.clusterId,
	);
	const envoy = new EnvoyService(
		new EnvoyClient(
			new NodeEnvoyTransport({
				directory: STATE_DIRECTORY,
				adminUrl: "http://envoy:9901",
				timeoutMs: 2000,
				maxResponseBytes: 16 * 1024 * 1024,
			}),
			sleep,
			{ attempts: 30, intervalMs: 1000 },
		),
		config.ingress,
	);
	await envoy.bootstrap();
	const networking = new NetworkingService(endpoints, envoy);
	const deployment = new DeploymentService([
		new RecreateDeploymentStrategy(docker, networking, probe, sleep),
		new SurgeDeploymentStrategy(docker, networking, probe, sleep, () => nanoid(10)),
	]);
	const reconciler = new ReconcilerService(
		config.services,
		config.reconciliation,
		new GitService(
			new GitClient(new NodeGitTransport(config.git.operationTimeoutSeconds * 1000, process.env)),
			`${STATE_DIRECTORY}/git`,
		),
		decodeDescriptorYaml,
		new WebResourceReconciler(docker, deployment, networking, probe),
		store,
		Date.now,
		new EnvironmentResolver("/etc/homelab-paas/env", readFile),
		Boolean(config.auth),
	);
	const abort = new AbortController();
	const pause = async (ms: number): Promise<void> => {
		try {
			await sleep(ms, abort.signal);
		} catch (error) {
			if (!abort.signal.aborted) throw error;
		}
	};
	const runner = new PeriodicTaskRunner({
		lifecycle,
		periodMs: config.git.pollIntervalSeconds * 1000,
		taskName: "reconciliation",
		generateTaskId: nanoid,
		task: new ReconcilerTask(reconciler),
		pause,
		report: (err) => logger.error({ err }, "Reconciliation task failed; check persistent state and Docker access"),
	});
	const app = new Koa().use(createRequestLogger()).use(createHealthCheckRouter().routes());
	app.on("error", (err) => logger.error({ err }, "HTTP request failed"));
	const certificates = new FileCertificateStore(STATE_DIRECTORY, readFile, secureWrite);
	let renewal: TlsCertRenewalTask | undefined;
	let sessions: AuthService | undefined;
	if (config.auth && config.tls) {
		const auth = new AuthService(
			new GitHubOauth2Provider(config.auth.github, fetch),
			new JwtClient(config.auth.session, Date.now),
			config.auth.github.allowedUsers,
			() => randomBytes(32).toString("base64url"),
			endpoints,
			{ baseDomain: config.ingress.baseDomain, httpsPort: config.ingress.httpsPort! },
		);
		sessions = auth;
		app.use(
			createAuthRouter(auth, {
				baseDomain: config.ingress.baseDomain,
				httpsPort: config.ingress.httpsPort!,
				ttlSeconds: config.auth.session.ttlSeconds,
				serviceIds: Object.keys(config.services),
			}).routes(),
		);
		renewal = new TlsCertRenewalTask(
			new TlsCertProvisionService(
				{ baseDomain: config.ingress.baseDomain, email: config.tls.acme.email },
				new AcmeClient(
					new DigitalOceanDnsAcmeChallengeProvider(
						{ baseDomain: config.ingress.baseDomain, apiToken: config.tls.dns.credentials.apiToken },
						fetch,
					),
					new AcmeAccountStore(
						new FileSystemKeyValueStore<string>(STATE_DIRECTORY, readFile, secureWrite, remove, {
							extension: "pem",
							serialize: (value) => value,
							deserialize: (value) => value,
						}),
					),
					acme,
				),
			),
			certificates,
			() => new Date(),
		);
	}
	const ui = createPaasUiRouter(
		new PaasUiService(
			config,
			new GitService(
				new GitClient(new NodeGitTransport(config.git.operationTimeoutSeconds * 1000, process.env)),
				`${STATE_DIRECTORY}/ui-git`,
			),
			decodeDescriptorYaml,
			docker,
			store,
		),
		sessions,
	);
	app.use(ui.routes()).use(ui.allowedMethods());
	app.use(
		createFrontendRouter(
			new FrontendService(
				new DirectoryUiFiles(
					fileURLToPath(new URL("../../paas-ui/dist", import.meta.url)),
					lstat,
					readFileBytes,
				),
			),
		).routes(),
	);
	const server = app.listen(8080, "0.0.0.0");
	lifecycle.registerShutdownHandler(
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error: unknown) => (error ? reject(error) : resolve())),
			),
	);
	await once(server, "listening");
	if (renewal) {
		try {
			await withLogContext({ task: "certificate-renewal", taskId: nanoid() }, async () => {
				try {
					await renewal!.run();
				} catch (error) {
					logger.error({ err: error }, "Certificate renewal failed; retaining the current certificate");
					throw error;
				}
			});
		} catch (cause) {
			const current = await certificates.read();
			if (!current || current.expiresAt <= Date.now())
				throw new Error("No usable ingress certificate; check ACME and DigitalOcean configuration", { cause });
		}
	}
	if (!lifecycle.isOpen()) return;
	await envoy.configureRoutes(await endpoints.getAll());
	if (!lifecycle.isOpen()) return;
	const runners = [runner];
	if (renewal)
		runners.push(
			new PeriodicTaskRunner({
				lifecycle,
				periodMs: 12 * 60 * 60 * 1000,
				taskName: "certificate-renewal",
				generateTaskId: nanoid,
				task: renewal,
				pause,
				report: (err) => logger.error({ err }, "Certificate renewal failed; retaining the current certificate"),
			}),
		);
	const running = Promise.all(runners.map((task) => task.start()));
	logger.info({ port: 8080 }, "Control plane ready; background reconciliation enabled");
	lifecycle.registerShutdownHandler(async () => {
		abort.abort();
		await running;
	});
}
