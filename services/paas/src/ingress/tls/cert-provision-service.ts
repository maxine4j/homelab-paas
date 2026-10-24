import type { IPaasConfig } from "../../config/paas-config.ts";
import type { IAcmeClient } from "./acme-client.ts";
import type { Certificate } from "./types.ts";

export interface ITlsCertProvisionService {
	/** Provisions the platform base-domain and wildcard certificate. Provisioning failures propagate. */
	provisionCert(): Promise<Certificate>;
}

export class TlsCertProvisionService implements ITlsCertProvisionService {
	constructor(
		private readonly config: IPaasConfig,
		private readonly client: IAcmeClient,
	) {}
	async provisionCert(): Promise<Certificate> {
		const { baseDomain } = this.config.getIngressConfig();
		return this.client.provision({
			domains: [baseDomain, `*.${baseDomain}`],
			email: this.config.getTlsConfig()!.acme.email,
		});
	}
}
