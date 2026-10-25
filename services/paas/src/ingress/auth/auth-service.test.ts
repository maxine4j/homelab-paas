import { expect, test, vi } from "vitest";

import type { Endpoint } from "../../reconciler/networking/types.ts";
import { testConfig } from "../../util/test/config.ts";
import { AuthService } from "./auth-service.ts";
import { JwtClient } from "./jwt-client.ts";

const session = { issuer: "paas", audience: "paas", signingKey: "a".repeat(32), ttlSeconds: 3600 };

test("uses each resource's policy and the primary policy for the service alias", async () => {
	const f = fixture();
	f.getAll.mockResolvedValue({
		"app.demo": { address: "10.0.0.1", port: 80, healthcheckPath: "/", public: false, primary: true },
		"admin.demo": { address: "10.0.0.2", port: 80, healthcheckPath: "/", public: true, primary: false },
	});
	expect(await f.service.authorize("demo", undefined)).toBe("login");
	expect(await f.service.authorize("app.demo", undefined)).toBe("login");
	expect(await f.service.authorize("admin.demo", undefined)).toBe("allowed");
});
const fixture = (httpsPort = 443, baseDomain = "example.test") => {
	let now = 1_800_000_000_000;
	const tokens = new JwtClient(
		testConfig({ auth: { ...testConfig().getAuthConfig()!, session: session } }),
		() => now,
	);
	const provider = {
		getLoginUrl: vi.fn((state: string) => `https://github.com/login?state=${state}`),
		fetchAccessToken: vi.fn(async () => "access"),
		fetchUserDetails: vi.fn(async () => ({ userId: "alice" })),
	};
	const getAll = vi.fn(async (): Promise<Record<string, Endpoint>> => ({
		public: { address: "10.0.0.2", port: 80, healthcheckPath: "/", public: true },
		private: { address: "10.0.0.3", port: 80, healthcheckPath: "/", public: false },
	}));
	return {
		service: new AuthService(
			provider,
			tokens,
			testConfig({
				auth: {
					...testConfig().getAuthConfig()!,
					github: { ...testConfig().getAuthConfig()!.github, allowedUsers: ["Alice"] },
				},
				ingress: { httpPort: 80, ...{ baseDomain, httpsPort } },
			}),
			() => "random-nonce",
			{ getAll, set: vi.fn() },
		),
		provider,
		getAll,
		advance: (ms: number) => {
			now += ms;
		},
	};
};

test("binds login state to the browser and return target before issuing an allowlisted session", async () => {
	const f = fixture();
	const login = f.service.beginLogin("https://demo.example.test/a?b=c");
	expect(login.url).toBe(`https://github.com/login?state=${login.state}`);
	const result = await f.service.completeLogin("code", login.state, "random-nonce");
	expect(result.redirectUri).toBe("https://demo.example.test/a?b=c");
	expect(f.service.verifyAuthCookie(result.session)).toEqual({ userId: "alice" });
	expect(f.provider.fetchAccessToken).toHaveBeenCalledWith("code", "https://auth.example.test/auth/callback");
	expect(f.provider.fetchUserDetails).toHaveBeenCalledWith("access");
	f.advance(3600_000);
	expect(f.service.verifyAuthCookie(result.session)).toBeUndefined();
});

test.each([443, 8443])(
	"derives the same platform callback for authorization and token exchange on port %s",
	async (port) => {
		const f = fixture(port);
		const login = f.service.beginLogin("https://demo.example.test/");
		const callback = `https://auth.example.test${port === 443 ? "" : `:${port}`}/auth/callback`;
		expect(f.provider.getLoginUrl).toHaveBeenCalledWith(login.state, callback);
		await f.service.completeLogin("code", login.state, "random-nonce");
		expect(f.provider.fetchAccessToken).toHaveBeenCalledWith("code", callback);
	},
);

test("derives the local development callback", () => {
	const f = fixture(443, "local.maxine4j.com");
	const login = f.service.beginLogin("https://test-service.local.maxine4j.com/");
	expect(f.provider.getLoginUrl).toHaveBeenCalledWith(login.state, "https://auth.local.maxine4j.com/auth/callback");
});

test("rejects tampered, expired and browser-mismatched state before contacting GitHub", async () => {
	const f = fixture();
	const login = f.service.beginLogin("https://demo.example.test/");
	for (const [state, nonce] of [
		[`${login.state}x`, "random-nonce"],
		[login.state, "other"],
		[login.state, undefined],
	]) {
		await expect(f.service.completeLogin("code", state!, nonce)).rejects.toThrow("Authentication failed");
	}
	f.advance(600_000);
	await expect(f.service.completeLogin("code", login.state, "random-nonce")).rejects.toThrow("Authentication failed");
	expect(f.provider.fetchAccessToken).not.toHaveBeenCalled();
	expect(f.service.verifyAuthCookie(login.state)).toBeUndefined();
});

test("denies users outside the allowlist and sanitizes provider failures", async () => {
	const f = fixture();
	const login = f.service.beginLogin("https://demo.example.test/");
	f.provider.fetchUserDetails.mockResolvedValue({ userId: "mallory" });
	await expect(f.service.completeLogin("code", login.state, "random-nonce")).rejects.toThrow("Authentication failed");
	const cause = new Error("SECRET");
	f.provider.fetchAccessToken.mockRejectedValue(cause);
	await expect(f.service.completeLogin("code", login.state, "random-nonce")).rejects.toMatchObject({
		message: "Authentication failed",
		cause,
	});
});

test("authorizes public and private routed services locally, and denies unknown routes", async () => {
	const f = fixture();
	expect(await f.service.authorize("public", undefined)).toBe("allowed");
	expect(await f.service.authorize("private", undefined)).toBe("login");
	expect(await f.service.authorize("missing", undefined)).toBe("missing");
	const login = f.service.beginLogin("https://private.example.test/");
	const { session } = await f.service.completeLogin("code", login.state, "random-nonce");
	expect(await f.service.authorize("private", session)).toBe("allowed");
	f.getAll.mockRejectedValue(new Error("unavailable"));
	await expect(f.service.authorize("public", session)).rejects.toThrow();
	expect(f.provider.fetchUserDetails).toHaveBeenCalledTimes(1);
});
