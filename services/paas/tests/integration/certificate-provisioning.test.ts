import acme from "acme-client";
import { expect, test } from "vitest";

import { AcmeClient } from "../../src/ingress/tls/acme-client.ts";
import { TlsCertProvisionService } from "../../src/ingress/tls/cert-provision-service.ts";
import { TlsCertRenewalTask } from "../../src/ingress/tls/cert-renewal-task.ts";
import { FileCertificateStore } from "../../src/ingress/tls/certificate-store.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "../../src/ingress/tls/dns-challenge/digitalocean-dns-challenge-provider.ts";
import { atomicWriteFile, readFile } from "../../src/util/file.ts";
import { testConfig } from "../../src/util/test/config.ts";
import { MockDigitalOcean } from "../mocks/digitalocean.ts";
import { artifactDirectory } from "../util/git.ts";
import { createTls } from "../util/tls.ts";

test("certificate orchestration uses real DNS HTTP contracts and retains valid PEM after failure", async () => {
	const directory = await artifactDirectory("certificate");
	const certificate = await createTls(directory, "apps.example.test");
	const dns = new MockDigitalOcean();
	await dns.server.listen();
	const config = testConfig({ ingress: { baseDomain: "apps.example.test", httpPort: 80, httpsPort: 443 } });
	const provider = new DigitalOceanDnsAcmeChallengeProvider(config, fetch, `${dns.server.url}/v2`);
	let requestedDomains: string[] | undefined;
	let requestedEmail: string | undefined;
	// Inject the ACME SDK boundary. DNS and certificate publication retain their real transports.
	const sdk = {
		...acme,
		crypto: {
			...acme.crypto,
			createCsr: async (options: Parameters<typeof acme.crypto.createCsr>[0]): Promise<[Buffer, Buffer]> => {
				requestedDomains = options?.altNames;
				return [Buffer.from(certificate.key), Buffer.from("test csr")];
			},
		},
		Client: class {
			async auto(options: acme.ClientAutoOptions) {
				requestedEmail = options.email;
				const authorization = { identifier: { type: "dns", value: "apps.example.test" } } as acme.Authorization;
				const challenge = { type: "dns-01", url: "challenge" } as Parameters<
					typeof options.challengeCreateFn
				>[1];
				await options.challengeCreateFn(authorization, challenge, "proof");
				await options.challengeRemoveFn(authorization, challenge, "proof");
				return certificate.cert;
			}
		} as unknown as typeof acme.Client,
	};
	const client = new AcmeClient(
		provider,
		{
			readAccountKey: async () => "persisted account",
			writeAccountKey: async () => {
				throw new Error("Must reuse account");
			},
		},
		sdk,
	);
	const store = new FileCertificateStore(directory, readFile, atomicWriteFile);
	let now = new Date();
	const task = new TlsCertRenewalTask(new TlsCertProvisionService(config, client), store, () => now);
	try {
		await task.run();
		expect(requestedDomains).toEqual(["apps.example.test", "*.apps.example.test"]);
		expect(requestedEmail).toBe("admin@example.com");
		expect(dns.records.size).toBe(0);
		expect(dns.server.requests.map((r) => [r.method, r.url.pathname])).toEqual([
			["GET", "/v2/domains/apps.example.test"],
			["GET", "/v2/domains/example.test"],
			["POST", "/v2/domains/example.test/records"],
			["DELETE", "/v2/domains/example.test/records/1"],
		]);
		expect(JSON.parse(dns.server.requests.at(2)!.body)).toEqual({
			type: "TXT",
			name: "_acme-challenge.apps",
			data: "proof",
			ttl: 300,
		});
		const pem = await readFile(`${directory}/ingress.pem`);
		expect(pem).toContain(certificate.cert.trim());
		await task.run();
		expect(dns.server.requests.filter((r) => r.method === "POST")).toHaveLength(1);
		now = new Date((await store.read())!.expiresAt - 86400_000);
		dns.failCreate = true;
		await expect(task.run()).rejects.toThrow("current certificate retained");
		expect(await readFile(`${directory}/ingress.pem`)).toBe(pem);
	} finally {
		await dns.server.close();
	}
});
