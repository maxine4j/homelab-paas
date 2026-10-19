import type { ConfigurationOptions } from "@kubernetes/client-node";

import type { CertificateBundle } from "./cert-provision-service.ts";
import type { CertificateTarget } from "./cert-renewal-task.ts";

export interface TlsSecretConfig {
	namespace: string;
	name: string;
	uid: string;
	ownershipToken: string;
}
interface SecretIdentity {
	name: string;
	namespace: string;
}
interface SecretApply extends SecretIdentity {
	fieldManager: string;
	force: boolean;
	body: {
		apiVersion: string;
		kind: string;
		type: string;
		metadata: SecretIdentity & { uid: string; resourceVersion: string };
		data: Record<string, string>;
	};
}
/** SDK seam remains inside this adapter; responses are validated before use. */
export interface KubernetesSecrets {
	readNamespacedSecret(request: SecretIdentity, options?: ConfigurationOptions): Promise<unknown>;
	patchNamespacedSecret(request: SecretApply, options?: ConfigurationOptions): Promise<unknown>;
}
export class CertificatePublicationError extends Error {
	constructor() {
		super("Certificate publication failed");
	}
}
export class KubernetesCertificateTarget implements CertificateTarget {
	constructor(_config: TlsSecretConfig, _api: KubernetesSecrets) {}
	async activate(_bundle: CertificateBundle): Promise<void> {
		throw new Error("not implemented");
	}
}
