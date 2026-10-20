import type { IAcmeClient } from "./acme-client.ts";
import type { Certificate } from "./types.ts";

export interface ITlsCertProvisionService {
	/** Provisions the platform base-domain and wildcard certificate. Provisioning failures propagate. */
	provisionCert(): Promise<Certificate>;
}

export class TlsCertProvisionService implements ITlsCertProvisionService {
	constructor(
		private readonly config: { baseDomain: string; email: string },
		private readonly client: IAcmeClient,
	) {}
	async provisionCert(): Promise<Certificate> {
		return this.client.provision({
			domains: [this.config.baseDomain, `*.${this.config.baseDomain}`],
			email: this.config.email,
		});
	}
}
