import type { PeriodicTask } from "../../task/periodic.ts";
import { createLogger } from "../../util/logger.ts";
import type { ITlsCertProvisionService } from "./cert-provision-service.ts";
import type { ICertificateStore } from "./certificate-store.ts";
export class TlsCertRenewalTask implements PeriodicTask {
	private readonly log = createLogger(TlsCertRenewalTask.name);
	constructor(
		private readonly provisioner: ITlsCertProvisionService,
		private readonly store: ICertificateStore,
		private readonly now: () => Date,
		private readonly requiredDomains: () => string[] = () => [],
	) {}
	async run(): Promise<void> {
		try {
			const current = await this.store.read();
			const covered = this.requiredDomains().every((domain) => current?.domains?.includes(domain));
			if (current && covered && current.expiresAt - this.now().getTime() >= 30 * 86400_000) return;
			this.log.info(
				{ event: "certificate.renewing", reason: !current ? "missing" : !covered ? "coverage" : "expiring" },
				"Certificate requires renewal; provisioning through ACME DNS-01",
			);
			await this.store.publish(await this.provisioner.provisionCert());
			this.log.info({ event: "certificate.renewed" }, "Certificate published; Envoy will reload TLS material");
		} catch (cause) {
			throw new Error("Certificate renewal failed; current certificate retained", { cause });
		}
	}
}
