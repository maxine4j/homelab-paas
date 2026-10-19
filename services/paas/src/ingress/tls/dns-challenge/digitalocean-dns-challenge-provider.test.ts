import { expect, it } from "vitest";

import { DigitalOceanDnsAcmeChallengeProvider } from "./digitalocean-dns-challenge-provider.ts";

it("creates apex and nested TXT records and cleans concurrent challenges independently", async () => {
	const requests: { url: string; options: RequestInit }[] = [];
	let id = 0;
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		{ domain: "example.com", accessToken: "secret" },
		async (url, options) => {
			requests.push({ url: String(url), options: options ?? {} });
			return options?.method === "DELETE"
				? new Response(null, { status: 204 })
				: Response.json({ domain_record: { id: ++id } });
		},
	);
	const challenge = provider.createStatefulChallenge();
	await Promise.all([
		challenge.createChallenge("apex", "example.com", "first"),
		challenge.createChallenge("wildcard", "example.com", "second"),
		challenge.createChallenge("nested", "api.example.com", "third"),
	]);
	expect(requests.slice(0, 3).map(({ options }) => JSON.parse(String(options.body)))).toEqual([
		{ type: "TXT", name: "_acme-challenge", data: "first", ttl: 300 },
		{ type: "TXT", name: "_acme-challenge", data: "second", ttl: 300 },
		{ type: "TXT", name: "_acme-challenge.api", data: "third", ttl: 300 },
	]);
	await challenge.removeChallenge("wildcard");
	await challenge.removeChallenge("apex");
	await challenge.removeChallenge("nested");
	await challenge.removeChallenge("nested");
	expect(requests.slice(3).map(({ url }) => url)).toEqual(
		[2, 1, 3].map((record) => `https://api.digitalocean.com/v2/domains/example.com/records/${record}`),
	);
	expect(requests.every(({ options }) => options.redirect === "error" && options.signal instanceof AbortSignal)).toBe(
		true,
	);
});

it("rejects out-of-zone names before I/O", async () => {
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		{ domain: "example.com", accessToken: "secret" },
		async () => {
			throw new Error("unexpected I/O");
		},
	);
	await expect(provider.createStatefulChallenge().createChallenge("id", "notexample.com", "value")).rejects.toThrow(
		"outside configured DNS zone",
	);
});

it("validates responses, sanitizes errors and keeps failed cleanup retryable", async () => {
	let failCleanup = true;
	const provider = new DigitalOceanDnsAcmeChallengeProvider(
		{ domain: "example.com", accessToken: "secret" },
		async (_url, options) => {
			if (options?.method === "DELETE") return new Response(null, { status: failCleanup ? 500 : 204 });
			return Response.json({ domain_record: { id: 123 } });
		},
	);
	const challenge = provider.createStatefulChallenge();
	await challenge.createChallenge("id", "example.com", "value");
	await expect(challenge.removeChallenge("id")).rejects.toThrow("DNS challenge request failed");
	failCleanup = false;
	await challenge.removeChallenge("id");
	for (const response of [
		Response.json({ domain_record: { id: "../../secret" } }),
		Response.json({ secret: "secret" }, { status: 401 }),
		new Response("invalid"),
	]) {
		const invalid = new DigitalOceanDnsAcmeChallengeProvider(
			{ domain: "example.com", accessToken: "secret" },
			async () => response,
		);
		await expect(invalid.createStatefulChallenge().createChallenge("id", "example.com", "value")).rejects.toThrow(
			"DNS challenge request failed",
		);
	}
});
