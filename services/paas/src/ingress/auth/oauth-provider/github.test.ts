import { describe, expect, it } from "vitest";

import { GitHubOauth2Provider } from "./github.ts";

const config = {
	clientId: "client",
	clientSecret: "secret",
	callbackUrl: "https://paas.example.com/api/auth/callback",
};

describe("GitHub OAuth provider", () => {
	it("uses the configured callback, state and PKCE without accepting a return URL", () => {
		const provider = new GitHubOauth2Provider(config, async () => {
			throw new Error("unexpected request");
		});
		const url = new URL(provider.getLoginUrl({ state: "state & value", codeChallenge: "challenge" }));
		expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: "code",
			client_id: "client",
			redirect_uri: config.callbackUrl,
			scope: "user:email",
			state: "state & value",
			code_challenge: "challenge",
			code_challenge_method: "S256",
		});
	});

	it("exchanges the code server-side and retrieves a validated user and verified primary email", async () => {
		const requests: { url: string; options: RequestInit }[] = [];
		const provider = new GitHubOauth2Provider(config, async (url, options) => {
			requests.push({ url: String(url), options: options ?? {} });
			if (String(url).endsWith("access_token")) return Response.json({ access_token: "token" });
			if (String(url).endsWith("emails"))
				return Response.json([
					{ email: "unverified@example.com", primary: true, verified: false },
					{ email: "verified@example.com", primary: true, verified: true },
				]);
			return Response.json({
				id: 42,
				login: "Alice",
				name: null,
				avatar_url: "https://github.com/avatar",
			});
		});
		expect(await provider.fetchAccessToken("code", "verifier")).toBe("token");
		expect(JSON.parse(String(requests.at(0)?.options.body))).toEqual({
			client_id: "client",
			client_secret: "secret",
			code: "code",
			redirect_uri: config.callbackUrl,
			code_verifier: "verifier",
		});
		expect(await provider.fetchUserDetails("token")).toEqual({
			userId: "42",
			username: "alice",
			avatarUrl: "https://github.com/avatar",
			email: "verified@example.com",
		});
		expect(
			requests.every(({ options }) => options.redirect === "error" && options.signal instanceof AbortSignal),
		).toBe(true);
	});

	it.each([
		() => Response.json({ error: "bad_verification_code", error_description: "secret" }),
		() => Response.json({ access_token: "secret" }, { status: 500 }),
		() => Response.json({ access_token: 42 }),
		() => new Response("not json"),
		() => {
			throw new Error("secret");
		},
	])("translates failed token responses without exposing credentials", async (response) => {
		const provider = new GitHubOauth2Provider(config, async () => response());
		await expect(provider.fetchAccessToken("code", "verifier")).rejects.toThrow("GitHub OAuth request failed");
	});

	it("rejects malformed identities and respects caller cancellation", async () => {
		const signal = AbortSignal.abort();
		const provider = new GitHubOauth2Provider(config, async (_url, options) => {
			options?.signal?.throwIfAborted();
			return Response.json({ login: "alice" });
		});
		await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub OAuth request failed");
		await expect(provider.fetchAccessToken("code", "verifier", signal)).rejects.toThrow(
			"GitHub OAuth request failed",
		);
	});
});
