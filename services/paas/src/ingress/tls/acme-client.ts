import type acme from "acme-client";

import type { IAcmeAccountStore } from "./acme-account-store.ts";
import type { IDnsAcmeChallengeProvider } from "./dns-challenge/digitalocean-dns-challenge-provider.ts";
import type { DnsChallengeRecord } from "./dns-challenge/types.ts";
import type { Certificate, CertificateRequest } from "./types.ts";
export interface IAcmeClient {
	/** Provisions through production ACME DNS-01. Failures retain the underlying cause. */
	provision(request: CertificateRequest): Promise<Certificate>;
}
export class AcmeClient implements IAcmeClient {
	constructor(
		private readonly dns: IDnsAcmeChallengeProvider,
		private readonly account: IAcmeAccountStore,
		private readonly sdk: typeof acme,
	) {}
	async provision(request: CertificateRequest): Promise<Certificate> {
		try {
			let accountKey = await this.account.readAccountKey();
			if (!accountKey) {
				accountKey = (await this.sdk.crypto.createPrivateKey()).toString();
				await this.account.writeAccountKey(accountKey);
			}
			const client = new this.sdk.Client({ directoryUrl: this.sdk.directory.letsencrypt.production, accountKey });
			const [key, csr] = await this.sdk.crypto.createCsr({
				altNames: request.domains,
			});
			const records = new Map<string, DnsChallengeRecord>();
			const cert = await client.auto({
				csr,
				email: request.email,
				termsOfServiceAgreed: true,
				challengePriority: ["dns-01"],
				challengeCreateFn: async (authorization, challenge, value) => {
					if (challenge.type !== "dns-01") throw new Error();
					records.set(challenge.url, await this.dns.createChallenge(authorization.identifier.value, value));
				},
				challengeRemoveFn: async (_authorization, challenge) => {
					const record = records.get(challenge.url);
					if (record) {
						await this.dns.removeChallenge(record);
						records.delete(challenge.url);
					}
				},
			});
			return { key: key.toString(), cert };
		} catch (cause) {
			throw new Error("Certificate provisioning failed", { cause });
		}
	}
}
