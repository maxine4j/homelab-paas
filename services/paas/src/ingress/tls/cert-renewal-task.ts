import type { PeriodicTask } from "../../task/periodic.ts";
import type { Logger } from "../../util/logging.ts";
import type { CertificateBundle, CertificateProvisioner } from "./cert-provision-service.ts";

export interface CertificateStore {
	load(): Promise<CertificateBundle | undefined>;
	/** Atomically and durably save the key/chain together with restrictive permissions. */
	save(bundle: CertificateBundle): Promise<void>;
}
export interface CertificateTarget {
	activate(bundle: CertificateBundle): Promise<void>;
}
export interface CertificateInspector {
	/** Reject malformed certificates and mismatched keys. */
	inspect(bundle: CertificateBundle): { validFrom: Date; validTo: Date };
}
export class CertificateRenewalError extends Error {}

export class TlsCertRenewalTask implements PeriodicTask {
	private readonly provisioner: CertificateProvisioner;
	private readonly store: CertificateStore;
	private readonly target: CertificateTarget;
	private readonly inspector: CertificateInspector;
	private readonly now: () => Date;
	private readonly logger: Logger;
	private readonly signal: AbortSignal | undefined;
	private running: Promise<void> | undefined;
	constructor(
		provisioner: CertificateProvisioner,
		store: CertificateStore,
		target: CertificateTarget,
		inspector: CertificateInspector,
		now: () => Date,
		logger: Logger,
		signal?: AbortSignal,
	) {
		this.provisioner = provisioner;
		this.store = store;
		this.target = target;
		this.inspector = inspector;
		this.now = now;
		this.logger = logger;
		this.signal = signal;
	}

	run(): Promise<void> {
		this.running ??= this.renew().finally(() => {
			this.running = undefined;
		});
		return this.running;
	}

	private async renew(): Promise<void> {
		this.signal?.throwIfAborted();
		const current = await this.store.load();
		this.signal?.throwIfAborted();
		const now = this.now().getTime();
		if (current) {
			const validity = this.inspector.inspect(current);
			if (validity.validFrom.getTime() <= now && validity.validTo.getTime() > now)
				await this.target.activate(current);
			if (validity.validFrom.getTime() <= now && validity.validTo.getTime() - now >= 30 * 86400000) return;
		}
		this.logger.info({ operation: "renew_certificate" }, "Requesting certificate renewal");
		const replacement = await this.provisioner.provisionCert(this.signal);
		this.signal?.throwIfAborted();
		const validity = this.inspector.inspect(replacement);
		if (!(validity.validFrom.getTime() <= now && validity.validTo.getTime() > now))
			throw new CertificateRenewalError("Certificate is not currently valid");
		await this.store.save(replacement);
		await this.target.activate(replacement);
		this.logger.info({ operation: "renew_certificate" }, "Certificate renewed");
	}
}
