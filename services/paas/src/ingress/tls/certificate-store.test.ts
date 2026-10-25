import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import acme from "acme-client";
import { expect, test } from "vitest";

import { FileSystemKeyValueStore } from "../../store/file-system-store.ts";
import { atomicWriteFile, mkdir, mkdtemp, readFile, rm, stat } from "../../util/file.ts";
import { parseYaml } from "../../util/yaml.ts";
import { AcmeAccountStore } from "./acme-account-store.ts";
import { FileCertificateStore } from "./certificate-store.ts";

test("persists account material and atomically publishes a validated PEM pair for filesystem SDS", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-tls-"));
	try {
		const write = async (path: string, content: string | Uint8Array) => {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			await atomicWriteFile(path, content);
		};
		const account = () =>
			new AcmeAccountStore(
				new FileSystemKeyValueStore<string>(
					directory,
					readFile,
					write,
					async (path) => {
						await rm(path, { force: true });
					},
					{ extension: "pem", serialize: (value) => value, deserialize: (value) => value },
				),
			);
		const store = new FileCertificateStore(directory, readFile, write);
		expect(await store.read()).toBeUndefined();
		expect(await account().readAccountKey()).toBeUndefined();
		await account().writeAccountKey("account-key");
		expect(await account().readAccountKey()).toBe("account-key");
		expect(await readFile(join(directory, "acme-account.pem"))).toBe("account-key");
		const [key, cert] = await acme.crypto.createAlpnCertificate(
			{ identifier: { type: "dns", value: "example.test" } } as acme.Authorization,
			"authorization",
		);
		await store.publish({ key: key.toString(), cert: cert.toString() });
		expect(await store.read()).toEqual({
			expiresAt: new Date(new X509Certificate(cert).validTo).getTime(),
			domains: ["example.test"],
		});
		const pem = await readFile(join(directory, "ingress.pem"));
		expect(pem).toContain(key.toString().trim());
		expect(pem).toContain(cert.toString().trim());
		const sds = parseYaml((await readFile(join(directory, "sds.yaml"))) ?? "", "sds.yaml");
		expect(sds).toEqual({
			resources: [
				{
					"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret",
					name: "ingress",
					tls_certificate: {
						certificate_chain: { filename: join(directory, "ingress.pem") },
						private_key: { filename: join(directory, "ingress.pem") },
						watched_directory: { path: directory },
					},
				},
			],
		});
		for (const name of ["ingress.pem", "acme-account.pem", "sds.yaml"])
			expect((await stat(join(directory, name))).mode & 0o777).toBe(0o600);
		await expect(store.publish({ key: "invalid", cert: cert.toString() })).rejects.toThrow(
			"Cannot publish TLS certificate",
		);
		await expect(
			store.publish({ key: (await acme.crypto.createPrivateKey()).toString(), cert: cert.toString() }),
		).rejects.toThrow("Cannot publish TLS certificate");
		expect(await readFile(join(directory, "ingress.pem"))).toBe(pem);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
