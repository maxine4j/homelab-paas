import { expect, test, vi } from "vitest";

import { testConfig } from "../../../util/test/config.ts";
import { GitHubOauth2Provider } from "./github.ts";

test("uses explicit provider endpoints without changing credentials or protocol", async () => {
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ access_token: "token", token_type: "bearer" }))
		.mockResolvedValueOnce(Response.json({ login: "alice" }));
	const provider = new GitHubOauth2Provider(testConfig(), request, {
		authorization: "http://localhost:9000/authorize",
		token: "http://localhost:9000/token",
		profile: "http://localhost:9000/user",
	});
	expect(new URL(provider.getLoginUrl("state", "https://auth.example.test/auth/callback")).origin).toBe(
		"http://localhost:9000",
	);
	await provider.fetchAccessToken("code", "https://auth.example.test/auth/callback");
	await provider.fetchUserDetails("token");
	expect(request.mock.calls.at(0)?.at(0)).toBe("http://localhost:9000/token");
	expect(request.mock.calls.at(1)?.at(0)).toBe("http://localhost:9000/user");
});

test("uses the service-supplied callback, encodes state and validates GitHub responses", async () => {
	const callback = "https://auth.example.test/auth/callback";
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ access_token: "token", token_type: "bearer" }))
		.mockResolvedValueOnce(Response.json({ login: "alice" }));
	const provider = new GitHubOauth2Provider(
		testConfig({
			auth: {
				...testConfig().getAuthConfig()!,
				github: { ...testConfig().getAuthConfig()!.github, ...{ clientId: "id", clientSecret: "SECRET" } },
			},
		}),
		request,
	);
	const url = new URL(provider.getLoginUrl("a&b=c", callback));
	expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
	expect(url.searchParams.get("state")).toBe("a&b=c");
	expect(url.searchParams.get("redirect_uri")).toBe(callback);
	expect(await provider.fetchAccessToken("code", callback)).toBe("token");
	const [, options] = request.mock.calls.at(0)!;
	expect(request.mock.calls.at(0)?.at(0)).toBe("https://github.com/login/oauth/access_token");
	expect(JSON.parse(String(options?.body))).toMatchObject({
		code: "code",
		redirect_uri: callback,
	});
	expect(await provider.fetchUserDetails("token")).toEqual({ userId: "alice" });
	expect(request.mock.calls.at(1)?.at(0)).toBe("https://api.github.com/user");
	request.mockResolvedValue(Response.json({ error: "SECRET" }));
	await expect(provider.fetchAccessToken("bad", callback)).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(Response.json({ login: 42 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(new Response("SECRET", { status: 500 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
});
