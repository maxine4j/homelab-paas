import { createServer } from "node:http";
import { once } from "node:events";
import acme from "acme-client";
import { app } from "./frontend/frontend-router.ts";
import { FrontendService } from "./frontend/frontend-service.ts";
import { DirectoryUiFiles } from "./frontend/frontend-store.ts";
import { loadEnv } from "./util/env.ts";
import type { Env } from "./util/env.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { createProcessLogger } from "./util/logging.ts";
import type { Logger } from "./util/logging.ts";
import { GitHubOauth2Provider } from "./ingress/auth/oauth-provider/github.ts";
import type { GitHubOauthConfig } from "./ingress/auth/oauth-provider/github.ts";
import type { Oauth2Provider } from "./ingress/auth/oauth-provider/types.ts";
import { AcmeCertificateClient } from "./ingress/tls/acme-client.ts";
import { TlsCertProvisionService } from "./ingress/tls/cert-provision-service.ts";
import { TlsCertRenewalTask } from "./ingress/tls/cert-renewal-task.ts";
import type { CertificateTarget } from "./ingress/tls/cert-renewal-task.ts";
import { CertificateFileStore, X509CertificateInspector } from "./ingress/tls/certificate-files.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "./ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";
import type { DigitalOceanDnsConfig } from "./ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";

export function createOauthProvider(config: GitHubOauthConfig): Oauth2Provider {
  return new GitHubOauth2Provider(config, fetch);
}

export interface TlsRuntimeConfig {
  rootDomain: string;
  environment: "staging" | "production";
  email: string;
  /** Caller loads the stable account key from private platform storage. Never generate on renewal. */
  accountKey: string;
  certificateDirectory: string;
  dns: DigitalOceanDnsConfig;
}

/** Composition only: the caller owns scheduling, shutdown and certificate publication. */
export function createTlsRenewalTask(
  config: TlsRuntimeConfig,
  target: CertificateTarget,
  signal: AbortSignal,
  logger: Logger,
): TlsCertRenewalTask {
  // acme-client exposes one shared HTTP client. Configure it once for this appliance's lifetime.
  acme.axios.defaults.timeout = 30_000;
  acme.axios.defaults.maxRedirects = 0;
  acme.axios.defaults.signal = signal;
  const authority = new AcmeCertificateClient(
    new acme.Client({
      directoryUrl: acme.directory.letsencrypt[config.environment],
      accountKey: config.accountKey,
      backoffAttempts: 10,
      backoffMin: 5_000,
      backoffMax: 30_000,
    }),
    async (altNames) => {
      const [key, csr] = await acme.crypto.createCsr({ altNames });
      return { key: key.toString(), csr: csr.toString() };
    },
    new DigitalOceanDnsAcmeChallengeProvider(config.dns, fetch),
  );
  return new TlsCertRenewalTask(
    new TlsCertProvisionService(config, authority),
    new CertificateFileStore(config.certificateDirectory),
    target,
    new X509CertificateInspector(),
    () => new Date(),
    logger,
    signal,
  );
}

export function createHttpServer(config: Env) {
  return app(
    new FrontendService(new DirectoryUiFiles(config.uiDirectory)),
    createProcessLogger(config.logLevel),
  );
}

export async function start(lifecycle: Lifecycle): Promise<void> {
  const config = loadEnv();
  const logger = createProcessLogger(config.logLevel);
  const server = createServer(createHttpServer(config).callback());
  server.requestTimeout = 30_000;
  server.timeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 30_000;
  lifecycle.registerShutdownHandler(async () => {
    logger.info({ operation: "shutdown" }, "draining HTTP connections");
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });
  server.listen(config.listen);
  await once(server, "listening");
  const address = server.address();
  if (address && typeof address !== "string")
    logger.info({ operation: "listen" }, `http://${config.listen.host}:${address.port}`);
}
