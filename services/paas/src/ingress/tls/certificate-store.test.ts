import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import acme from "acme-client";
import { expect, test } from "vitest";
import yaml from "yaml";

import { FileCertificateStore } from "./certificate-store.ts";

test("persists account material and atomically publishes a validated PEM pair for filesystem SDS", async () => {
	const directory = await mkdtemp(join(tmpdir(), "paas-tls-"));
	try {
		const store = new FileCertificateStore(directory);
		expect(await store.read()).toBeUndefined();
		expect(await store.readAccountKey()).toBeUndefined();
		await store.writeAccountKey("account-key");
		expect(await new FileCertificateStore(directory).readAccountKey()).toBe("account-key");
		const [key, cert] = await acme.crypto.createAlpnCertificate(
			{ identifier: { type: "dns", value: "example.test" } } as acme.Authorization,
			"authorization",
		);
		await store.publish({ key: key.toString(), cert: cert.toString() });
		expect(await store.read()).toEqual({ expiresAt: new Date(new X509Certificate(cert).validTo).getTime() });
		const pem = await readFile(join(directory, "ingress.pem"), "utf8");
		expect(pem).toContain(key.toString().trim());
		expect(pem).toContain(cert.toString().trim());
		const sds = yaml.parse(await readFile(join(directory, "sds.yaml"), "utf8"));
		expect(sds.resources).toEqual([
			{
				"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret",
				name: "ingress",
				tls_certificate: {
					certificate_chain: { filename: join(directory, "ingress.pem") },
					private_key: { filename: join(directory, "ingress.pem") },
					watched_directory: { path: directory },
				},
			},
		]);
		for (const name of ["ingress.pem", "acme-account.pem", "sds.yaml"])
			expect((await stat(join(directory, name))).mode & 0o777).toBe(0o600);
		await expect(store.publish({ key: "invalid", cert: cert.toString() })).rejects.toThrow(
			"Cannot publish TLS certificate",
		);
		await expect(
			store.publish({ key: (await acme.crypto.createPrivateKey()).toString(), cert: cert.toString() }),
		).rejects.toThrow("Cannot publish TLS certificate");
		expect(await readFile(join(directory, "ingress.pem"), "utf8")).toBe(pem);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
