import { expect, test, vi } from "vitest";

import { testConfig } from "../../../util/test/config.ts";
import { DigitalOceanDnsAcmeChallengeProvider } from "./digitalocean-dns-challenge-provider.ts";

test("uses an explicit API origin for zone lookup and record creation", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ domain: { name: "example.test" } }))
		.mockResolvedValueOnce(Response.json({ domain_record: { id: 7 } }));
	const provider = new DigitalOceanDnsAcmeChallengeProvider(testConfig(), request, "http://localhost:9001/v2");
	expect(await provider.createChallenge("example.test", "proof")).toEqual({ zone: "example.test", id: 7 });
	expect(request.mock.calls.at(0)?.at(0)).toBe("http://localhost:9001/v2/domains/example.test");
	expect(request.mock.calls.at(1)?.at(0)).toBe("http://localhost:9001/v2/domains/example.test/records");
});

test("discovers the managed zone, creates the correct TXT record and deletes only its own ID", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response("", { status: 404 }))
		.mockResolvedValueOnce(Response.json({ domain: { name: "example.com" } }))
		.mockResolvedValueOnce(Response.json({ domain_record: { id: 123 } }))
		.mockResolvedValueOnce(new Response(null, { status: 204 }));
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		testConfig({
			ingress: { ...testConfig().getIngressConfig(), baseDomain: "apps.example.com" },
			tls: {
				...testConfig().getTlsConfig()!,
				dns: { provider: "digitalocean", credentials: { apiToken: "SECRET" } },
			},
		}),
		request,
	);
	const record = await provider.createChallenge("apps.example.com", "value");
	expect(record).toEqual({ zone: "example.com", id: 123 });
	expect(request.mock.calls.at(2)?.at(0)).toBe("https://api.digitalocean.com/v2/domains/example.com/records");
	const [, options] = request.mock.calls.at(2)!;
	expect(JSON.parse(String(options?.body))).toEqual({
		type: "TXT",
		name: "_acme-challenge.apps",
		data: "value",
		ttl: 300,
	});
	await provider.removeChallenge(record);
	expect(request.mock.calls.at(3)?.at(0)).toBe("https://api.digitalocean.com/v2/domains/example.com/records/123");
});

test("handles a base-domain zone and rejects malformed responses or unrelated identifiers without leaking errors", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ domain: { name: "example.com" } }))
		.mockResolvedValueOnce(Response.json({ domain_record: { id: 456 } }));
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		testConfig({
			ingress: { ...testConfig().getIngressConfig(), baseDomain: "example.com" },
			tls: {
				...testConfig().getTlsConfig()!,
				dns: { provider: "digitalocean", credentials: { apiToken: "SECRET" } },
			},
		}),
		request,
	);
	await provider.createChallenge("*.example.com", "value");
	const [, options] = request.mock.calls.at(1)!;
	expect(JSON.parse(String(options?.body)).name).toBe("_acme-challenge");
	await expect(provider.createChallenge("evil.test", "value")).rejects.toThrow("DNS challenge failed");
	request.mockResolvedValue(Response.json({ domain_record: { id: "SECRET" } }));
	await expect(provider.createChallenge("example.com", "value")).rejects.toThrow("DNS challenge failed");
	request.mockRejectedValue(new Error("SECRET"));
	await expect(provider.removeChallenge({ zone: "example.com", id: 123 })).rejects.toThrow("DNS challenge failed");
});
