import { expect, test, vi } from "vitest";

import { GitHubOauth2Provider } from "./github.ts";

test("uses a fixed callback, encodes state and validates GitHub responses", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ access_token: "token", token_type: "bearer" }))
		.mockResolvedValueOnce(Response.json({ login: "alice" }));
	const provider = new GitHubOauth2Provider(
		{ clientId: "id", clientSecret: "SECRET", callbackUrl: "https://auth.example.test/oauth/github/callback" },
		request,
	);
	const url = new URL(provider.getLoginUrl("a&b=c"));
	expect(url.searchParams.get("state")).toBe("a&b=c");
	expect(url.searchParams.get("redirect_uri")).toBe("https://auth.example.test/oauth/github/callback");
	expect(await provider.fetchAccessToken("code")).toBe("token");
	const [, options] = request.mock.calls.at(0)!;
	expect(JSON.parse(String(options?.body))).toMatchObject({
		code: "code",
		redirect_uri: "https://auth.example.test/oauth/github/callback",
	});
	expect(await provider.fetchUserDetails("token")).toEqual({ userId: "alice" });
	request.mockResolvedValue(Response.json({ error: "SECRET" }));
	await expect(provider.fetchAccessToken("bad")).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(Response.json({ login: 42 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(new Response("SECRET", { status: 500 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
});
