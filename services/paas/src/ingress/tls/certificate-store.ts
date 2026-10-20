import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSecureContext } from "node:tls";

import yaml from "yaml";

import type { Certificate } from "./types.ts";
export interface IAcmeAccountStore {
	readAccountKey(): Promise<string | undefined>;
	writeAccountKey(key: string): Promise<void>;
}
export interface ICertificateStore {
	read(): Promise<{ expiresAt: number } | undefined>;
	/** Validates the certificate/key pair before atomic SDS publication. Failures retain the active SDS secret. */
	publish(certificate: Certificate): Promise<void>;
}
export class FileCertificateStore implements ICertificateStore, IAcmeAccountStore {
	constructor(private readonly directory: string) {}
	async read(): Promise<{ expiresAt: number } | undefined> {
		try {
			const pem = await this.readOptional("ingress.pem");
			if (!pem) return undefined;
			return { expiresAt: new Date(new X509Certificate(pem).validTo).getTime() };
		} catch {
			throw new Error("Cannot read TLS certificate");
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
				yaml.stringify({
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
		} catch {
			throw new Error("Cannot publish TLS certificate");
		}
	}
	async readAccountKey(): Promise<string | undefined> {
		return this.readOptional("acme-account.pem");
	}
	async writeAccountKey(key: string): Promise<void> {
		await this.atomic("acme-account.pem", key);
	}
	private async readOptional(name: string): Promise<string | undefined> {
		try {
			return await readFile(join(this.directory, name), "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw new Error("Cannot read TLS state");
		}
	}
	private async atomic(name: string, value: string): Promise<void> {
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const target = join(this.directory, name);
			await writeFile(`${target}.tmp`, value, { mode: 0o600 });
			await rename(`${target}.tmp`, target);
		} catch {
			throw new Error("Cannot write TLS state");
		}
	}
}
