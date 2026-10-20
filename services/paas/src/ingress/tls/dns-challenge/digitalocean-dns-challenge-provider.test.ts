import { expect, test, vi } from "vitest";

import { DigitalOceanDnsAcmeChallengeProvider } from "./digitalocean-dns-challenge-provider.ts";

test("discovers the managed zone, creates the correct TXT record and deletes only its own ID", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response("", { status: 404 }))
		.mockResolvedValueOnce(Response.json({ domain: { name: "example.com" } }))
		.mockResolvedValueOnce(Response.json({ domain_record: { id: 123 } }))
		.mockResolvedValueOnce(new Response(null, { status: 204 }));
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		{ baseDomain: "apps.example.com", apiToken: "SECRET" },
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
		{ baseDomain: "example.com", apiToken: "SECRET" },
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
