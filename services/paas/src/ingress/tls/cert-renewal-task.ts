import type { PeriodicTask } from "../../task/periodic.ts";
import type { ITlsCertProvisionService } from "./cert-provision-service.ts";
import type { ICertificateStore } from "./certificate-store.ts";
export class TlsCertRenewalTask implements PeriodicTask {
	constructor(
		private readonly provisioner: ITlsCertProvisionService,
		private readonly store: ICertificateStore,
		private readonly now: () => Date,
	) {}
	async run(): Promise<void> {
		try {
			const current = await this.store.read();
			if (current && current.expiresAt - this.now().getTime() >= 30 * 86400_000) return;
			await this.store.publish(await this.provisioner.provisionCert());
		} catch {
			throw new Error("Certificate renewal failed; current certificate retained");
		}
	}
}
