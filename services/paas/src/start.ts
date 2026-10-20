import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

import acme from "acme-client";
import Koa from "koa";
import { nanoid } from "nanoid";

import { bootstrap } from "./bootstrap.ts";
import { PaasConfig, decodeDescriptorYaml } from "./config/paas-config.ts";
import { DockerClient } from "./docker/docker-client.ts";
import { DockerService } from "./docker/docker-service.ts";
import { NodeDockerTransport } from "./docker/docker-transport.ts";
import { EnvoyClient } from "./envoy/envoy-client.ts";
import { EnvoyService } from "./envoy/envoy-service.ts";
import { NodeEnvoyTransport } from "./envoy/envoy-transport.ts";
import { GitClient } from "./git/git-client.ts";
import { GitService } from "./git/git-service.ts";
import { NodeGitTransport } from "./git/git-transport.ts";
import { createAuthRouter } from "./ingress/auth/auth-router.ts";
import { AuthService } from "./ingress/auth/auth-service.ts";
import { JwtClient } from "./ingress/auth/jwt-client.ts";
import { GitHubOauth2Provider } from "./ingress/auth/oauth-provider/github.ts";
import { AcmeClient } from "./ingress/tls/acme-client.ts";
import { TlsCertProvisionService } from "./ingress/tls/cert-provision-service.ts";
import { TlsCertRenewalTask } from "./ingress/tls/cert-renewal-task.ts";
import { FileCertificateStore } from "./ingress/tls/certificate-store.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "./ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";
import { DeploymentService } from "./reconciler/deployment/deployment-service.ts";
import { RecreateDeploymentStrategy } from "./reconciler/deployment/strategy/recreate-deployment-strategy.ts";
import { SurgeDeploymentStrategy } from "./reconciler/deployment/strategy/surge-deployment-strategy.ts";
import { FileReconciliationStore } from "./reconciler/file-reconciliation-store.ts";
import { NetworkingService } from "./reconciler/networking/networking-service.ts";
import { ReconcilerService } from "./reconciler/reconciler-service.ts";
import { ReconcilerTask } from "./reconciler/reconciler-task.ts";
import { WebResourceReconciler } from "./reconciler/resources/web/web-reconciler.ts";
import { PeriodicTaskRunner } from "./task/periodic.ts";
import { readFile } from "./util/file.ts";
import { createHealthCheckRouter, probe } from "./util/healthcheck.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { logger } from "./util/logger.ts";
import { sleep } from "./util/sleep.ts";

const STATE_DIRECTORY = "/var/homelab-paas/_paas";

export async function start(lifecycle: Lifecycle): Promise<void> {
	const config = await new PaasConfig(readFile, process.env).load();
	await bootstrap(STATE_DIRECTORY);
	const store = new FileReconciliationStore(STATE_DIRECTORY);
	const docker = new DockerService(
		new DockerClient(
			new NodeDockerTransport({
				socketPath: "/var/run/docker.sock",
				timeoutMs: 120_000,
				maxResponseBytes: 16 * 1024 * 1024,
			}),
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
	const networking = new NetworkingService(store, envoy, sleep);
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
		(serviceId, message) => logger.error({ serviceId }, message),
		Boolean(config.auth),
	);
	const abort = new AbortController();
	const runner = new PeriodicTaskRunner({
		lifecycle,
		periodMs: config.git.pollIntervalSeconds * 1000,
		task: new ReconcilerTask(reconciler),
		pause: async (ms) => {
			try {
				await setTimeout(ms, undefined, { signal: abort.signal });
			} catch {
				/* Shutdown interrupts the polling delay. */
			}
		},
		report: () => logger.error("Reconciliation task failed; check persistent state and Docker access"),
	});
	const app = new Koa().use(createHealthCheckRouter().routes());
	const certificates = new FileCertificateStore(STATE_DIRECTORY);
	let renewal: TlsCertRenewalTask | undefined;
	if (config.auth && config.tls) {
		const auth = new AuthService(
			new GitHubOauth2Provider(config.auth.github, fetch),
			new JwtClient(config.auth.session, Date.now),
			config.auth.github.allowedUsers,
			() => randomBytes(32).toString("base64url"),
			store,
			{ baseDomain: config.ingress.baseDomain, httpsPort: config.ingress.httpsPort! },
		);
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
					certificates,
					acme,
				),
			),
			certificates,
			() => new Date(),
		);
	}
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
			await renewal.run();
		} catch {
			logger.error("Certificate renewal failed; retaining the current certificate");
			const current = await certificates.read();
			if (!current || current.expiresAt <= Date.now())
				throw new Error("No usable ingress certificate; check ACME and DigitalOcean configuration");
		}
	}
	if (!lifecycle.isOpen()) return;
	await envoy.configureRoutes(await store.getAll());
	if (!lifecycle.isOpen()) return;
	const runners = [runner];
	if (renewal)
		runners.push(
			new PeriodicTaskRunner({
				lifecycle,
				periodMs: 12 * 60 * 60 * 1000,
				task: renewal,
				pause: async (ms) => {
					try {
						await setTimeout(ms, undefined, { signal: abort.signal });
					} catch {
						/* Shutdown interrupts renewal delay. */
					}
				},
				report: () => logger.error("Certificate renewal failed; retaining the current certificate"),
			}),
		);
	const running = Promise.all(runners.map((task) => task.start()));
	lifecycle.registerShutdownHandler(async () => {
		abort.abort();
		await running;
	});
}
