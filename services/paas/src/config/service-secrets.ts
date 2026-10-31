import type { UiSecrets, UiSecretsUpdate } from "@homelab-paas/shared-contracts";

import type { IGitService } from "../git/git-service.ts";
import type { DescriptorDecoder } from "../reconciler/types.ts";
import type { IPaasConfig } from "./paas-config.ts";
import type { ISecretStore } from "./secret-store.ts";
import { SecretEditError } from "./secret-store.ts";
import type { SecretDocument } from "./types.ts";

export interface IServiceSecrets {
	/** Only names/status are returned. Throws SecretEditError; causes are for operator logs only. */
	read(serviceId: string): Promise<UiSecrets>;
	/** Merges write-only edits; periodic reconciliation observes changes, retaining retry backoff. */
	update(serviceId: string, update: UiSecretsUpdate): Promise<UiSecrets>;
}

export class ServiceSecrets implements IServiceSecrets {
	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly store: ISecretStore,
	) {}
	async read(serviceId: string): Promise<UiSecrets> {
		const descriptor = await this.descriptor(serviceId);
		return this.metadata(descriptor, await this.store.read(serviceId));
	}
	async update(serviceId: string, update: UiSecretsUpdate): Promise<UiSecrets> {
		const descriptor = await this.descriptor(serviceId);
		const current = await this.store.read(serviceId);
		if (update.revision !== this.metadata(descriptor, current).revision) throw new SecretEditError("conflict");
		return this.metadata(descriptor, await this.store.update(serviceId, current.revision, update.changes));
	}
	private async descriptor(serviceId: string): Promise<{ revision: string; names: Set<string> }> {
		const services = this.config.getServices();
		if (
			serviceId.length > 63
			|| !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId)
			|| !Object.hasOwn(services, serviceId)
		)
			throw new SecretEditError("not-found");
		try {
			const file = await this.git.fetchFile(serviceId, services[serviceId]!);
			const descriptor = this.decode(file.content, serviceId, file.revision);
			return {
				revision: file.revision,
				names: new Set(
					Object.values(descriptor.resources).flatMap((resource) =>
						"env" in resource
							? (resource.env ?? []).filter((entry) => "secret" in entry).map((entry) => entry.name)
							: [],
					),
				),
			};
		} catch (cause) {
			throw new SecretEditError("unavailable", { cause });
		}
	}
	private metadata(descriptor: { revision: string; names: Set<string> }, document: SecretDocument): UiSecrets {
		return {
			revision: `${descriptor.revision}:${document.revision}`,
			variables: [
				...[...descriptor.names]
					.sort()
					.map((name) => ({ name, configured: document.values.has(name), used: true })),
				...[...document.values.keys()]
					.filter((name) => !descriptor.names.has(name))
					.sort()
					.map((name) => ({ name, configured: true, used: false })),
			],
		};
	}
}
