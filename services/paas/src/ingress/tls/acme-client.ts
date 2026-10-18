import acme from "acme-client";
import type { Client, ClientAutoOptions } from "acme-client";
import type {
  CertificateAuthority,
  CertificateBundle,
  CertificateRequest,
} from "./cert-provision-service.ts";
import { CertificateProvisionError } from "./cert-provision-service.ts";
import type { DnsAcmeChallengeProvider } from "./dns-challenge/types.ts";

/** SDK-shaped seam stays inside this adapter; services use CertificateAuthority. */
export interface AcmeSession {
  createCsr(altNames: string[]): Promise<{ key: string; csr: string }>;
  auto(options: ClientAutoOptions): Promise<string>;
}

export interface AcmeSessionConfig {
  environment: "staging" | "production";
  /** Stable account key loaded from private platform storage. */
  accountKey: string;
}

export class AcmeSdkSession implements AcmeSession {
  private readonly client: Client;

  constructor(config: AcmeSessionConfig, signal: AbortSignal) {
    // The SDK shares one HTTP client; configure once for the appliance's lifetime.
    acme.axios.defaults.timeout = 30_000;
    acme.axios.defaults.maxRedirects = 0;
    acme.axios.defaults.signal = signal;
    this.client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt[config.environment],
      accountKey: config.accountKey,
      backoffAttempts: 10,
      backoffMin: 5_000,
      backoffMax: 30_000,
    });
  }

  async createCsr(altNames: string[]): Promise<{ key: string; csr: string }> {
    const [key, csr] = await acme.crypto.createCsr({ altNames });
    return { key: key.toString(), csr: csr.toString() };
  }

  auto(options: ClientAutoOptions): Promise<string> {
    return this.client.auto(options);
  }
}

export class AcmeCertificateClient implements CertificateAuthority {
  private readonly client: AcmeSession;
  private readonly provider: DnsAcmeChallengeProvider;
  constructor(client: AcmeSession, provider: DnsAcmeChallengeProvider) {
    this.client = client;
    this.provider = provider;
  }

  async issueCertificate(
    request: CertificateRequest,
    signal?: AbortSignal,
  ): Promise<CertificateBundle> {
    const challenge = this.provider.createStatefulChallenge();
    const outstanding = new Set<string>();
    let bundle: CertificateBundle | undefined;
    let failed = false;
    try {
      signal?.throwIfAborted();
      const { key, csr } = await this.client.createCsr(request.altNames);
      const cert = await this.client.auto({
        csr,
        email: request.email,
        termsOfServiceAgreed: true,
        challengePriority: ["dns-01"],
        challengeCreateFn: async (authz, entry, value) => {
          signal?.throwIfAborted();
          if (entry.type !== "dns-01") throw new CertificateProvisionError();
          await challenge.createChallenge(entry.url, authz.identifier.value, value, signal);
          outstanding.add(entry.url);
        },
        challengeRemoveFn: async (_authz, entry) => {
          // Cleanup must still work after cancellation of issuance.
          await challenge.removeChallenge(entry.url);
          outstanding.delete(entry.url);
        },
      });
      signal?.throwIfAborted();
      bundle = { key, cert };
    } catch {
      failed = true;
    } finally {
      const cleanup = await Promise.allSettled(
        [...outstanding].map((id) => challenge.removeChallenge(id)),
      );
      if (cleanup.some((result) => result.status === "rejected")) failed = true;
    }
    if (failed || !bundle) throw new CertificateProvisionError();
    return bundle;
  }
}
