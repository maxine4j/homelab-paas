import type { ClientAutoOptions } from "acme-client";
import type {
  CertificateAuthority,
  CertificateBundle,
  CertificateRequest,
} from "./cert-provision-service.ts";
import { CertificateProvisionError } from "./cert-provision-service.ts";
import type { DnsAcmeChallengeProvider } from "./dns-challenge/types.ts";

/** SDK-shaped seam stays inside this adapter; services use CertificateAuthority. */
export interface AcmeSession {
  auto(options: ClientAutoOptions): Promise<string>;
}
export type CreateCsr = (altNames: string[]) => Promise<{ key: string; csr: string }>;

export class AcmeCertificateClient implements CertificateAuthority {
  private readonly client: AcmeSession;
  private readonly createCsr: CreateCsr;
  private readonly provider: DnsAcmeChallengeProvider;
  constructor(client: AcmeSession, createCsr: CreateCsr, provider: DnsAcmeChallengeProvider) {
    this.client = client;
    this.createCsr = createCsr;
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
      const { key, csr } = await this.createCsr(request.altNames);
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
