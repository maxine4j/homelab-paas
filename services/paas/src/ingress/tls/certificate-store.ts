import { createPrivateKey, X509Certificate } from "node:crypto";
import { join } from "node:path";
import { createSecureContext } from "node:tls";

import type { FileReader, FileWriter } from "../../util/file.ts";
import { stringifyYaml } from "../../util/yaml.ts";
import type { Certificate } from "./types.ts";
export interface ICertificateStore {
	read(): Promise<{ expiresAt: number; domains?: string[] } | undefined>;
	/** Validates the certificate/key pair before atomic SDS publication. Failures retain the active SDS secret. */
	publish(certificate: Certificate): Promise<void>;
}
export class FileCertificateStore implements ICertificateStore {
	constructor(
		private readonly directory: string,
		private readonly readFile: FileReader,
		private readonly writeFile: FileWriter,
	) {}
	async read(): Promise<{ expiresAt: number; domains: string[] } | undefined> {
		try {
			const pem = await this.readOptional("ingress.pem");
			if (!pem) return undefined;
			const certificate = new X509Certificate(pem);
			return {
				expiresAt: new Date(certificate.validTo).getTime(),
				domains: (certificate.subjectAltName ?? "")
					.split(", ")
					.filter((name) => name.startsWith("DNS:"))
					.map((name) => name.slice(4)),
			};
		} catch (cause) {
			throw new Error("Cannot read TLS certificate", { cause });
		}
	}
	async publish(certificate: Certificate): Promise<void> {
		try {
			createSecureContext(certificate);
			if (!new X509Certificate(certificate.cert).checkPrivateKey(createPrivateKey(certificate.key)))
				throw new Error();
			const filename = join(this.directory, "ingress.pem");
			// SDS watches this directory. One atomic PEM replacement rotates the pair together.
			await this.atomic(
				"sds.yaml",
				stringifyYaml({
					resources: [
						{
							"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret",
							name: "ingress",
							tls_certificate: {
								certificate_chain: { filename },
								private_key: { filename },
								watched_directory: { path: this.directory },
							},
						},
					],
				}),
			);
			await this.atomic("ingress.pem", `${certificate.cert.trim()}\n${certificate.key.trim()}\n`);
		} catch (cause) {
			throw new Error("Cannot publish TLS certificate", { cause });
		}
	}
	private async readOptional(name: string): Promise<string | undefined> {
		try {
			return await this.readFile(join(this.directory, name));
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw new Error("Cannot read TLS state", { cause: error });
		}
	}
	private async atomic(name: string, value: string): Promise<void> {
		try {
			await this.writeFile(join(this.directory, name), value, { mode: 0o600 });
		} catch (cause) {
			throw new Error("Cannot write TLS state", { cause });
		}
	}
}
