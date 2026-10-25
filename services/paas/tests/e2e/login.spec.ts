import { test, expect } from "../util/browser-fixtures.ts";

test("browser OAuth returns to the original private URL and shares a session with management", async ({
	environment: env,
	page,
	context,
}) => {
	const target = env.url("private", "/version?original=one%20two");
	const response = await page.goto(target);
	await expect(page).toHaveURL(target);
	expect(await response!.json()).toEqual({ version: "v1" });
	expect(env.github.server.requests.map((r) => r.url.pathname)).toEqual(["/authorize", "/token", "/user"]);
	const cookies = await context.cookies();
	expect(cookies.find((c) => c.name === "__Secure-paas_session")).toMatchObject({
		domain: `.${env.config.ingress.baseDomain}`,
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		path: "/",
	});
	expect(cookies.find((c) => c.name === "__Host-paas_oauth")).toBeUndefined();
	const second = await page.goto(env.url("second", "/version"));
	expect(await second!.json()).toEqual({ version: "v1" });
	await page.goto(env.url(""));
	await expect(page).toHaveTitle("Homelab PaaS");
	await expect(page.getByRole("heading", { name: /^Services\b/, level: 1 })).toBeVisible();
	await expect(page.getByRole("heading", { name: "private", level: 2, exact: true })).toBeVisible();
	expect(env.github.server.requests.filter((r) => r.url.pathname === "/token")).toHaveLength(1);
});

test("browser denies a GitHub user outside the allowlist", async ({ environment: env, page, context }) => {
	env.github.user = "Mallory";
	const response = await page.goto(env.url("private", "/version"));
	expect(response?.status()).toBe(403);
	expect(new URL(page.url()).pathname).toBe("/auth/callback");
	expect((await context.cookies()).find((c) => c.name === "__Secure-paas_session")).toBeUndefined();
});
