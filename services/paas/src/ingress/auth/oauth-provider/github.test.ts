import { expect, test, vi } from "vitest";

import { testConfig } from "../../../util/test/config.ts";
import { GitHubOauth2Provider } from "./github.ts";

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
	expect(url.searchParams.get("state")).toBe("a&b=c");
	expect(url.searchParams.get("redirect_uri")).toBe(callback);
	expect(await provider.fetchAccessToken("code", callback)).toBe("token");
	const [, options] = request.mock.calls.at(0)!;
	expect(JSON.parse(String(options?.body))).toMatchObject({
		code: "code",
		redirect_uri: callback,
	});
	expect(await provider.fetchUserDetails("token")).toEqual({ userId: "alice" });
	request.mockResolvedValue(Response.json({ error: "SECRET" }));
	await expect(provider.fetchAccessToken("bad", callback)).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(Response.json({ login: 42 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
	request.mockResolvedValue(new Response("SECRET", { status: 500 }));
	await expect(provider.fetchUserDetails("token")).rejects.toThrow("GitHub authentication unavailable");
});
