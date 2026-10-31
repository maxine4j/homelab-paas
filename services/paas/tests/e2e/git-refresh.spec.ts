import { test, expect } from "../util/browser-fixtures.ts";

test("manual refresh fetches one service independently and all services on demand", async ({
	environment: env,
	page,
}) => {
	// Restart after changing the interval to discard the previously scheduled one-second refresh.
	await page.goto(env.url("", "/#/cluster"));
	await page
		.getByRole("region", { name: "git", exact: true })
		.getByLabel("pollIntervalSeconds", { exact: true })
		.fill("3600");
	await page.getByRole("button", { name: "Save configuration" }).click();
	await expect(page.getByRole("status")).toHaveText("Configuration saved");
	await env.compose(["restart", "paas"]);
	await env.waitReady("public", "v1");
	await page.goto(env.url("", "/#/services"));
	// Join any startup refresh before publishing the revision used to prove isolation.
	await page.getByRole("button", { name: "Refresh all", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "Git refresh complete" })).toBeVisible();
	await page.goto(env.url("", "/#/services/public"));
	const before = (await env.checkpoint("second"))!.activeRevision;
	const revision = await env.update("public", "v2");
	const response = page.waitForResponse(
		(result) => result.url().endsWith("/api/ui/services/public/refresh") && result.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	expect((await response).status()).toBe(200);
	await expect(page.getByRole("status").filter({ hasText: "Git refresh complete" })).toBeVisible();
	await env.waitReady("public", "v2");
	expect((await env.checkpoint("public"))!.activeRevision).toBe(revision);
	// Every service uses its own cache even though this fixture uses the same remote.
	expect((await env.checkpoint("second"))!.activeRevision).toBe(before);
	await page.goto(env.url("", "/#/services"));
	await page.getByRole("button", { name: "Refresh all", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "Git refresh complete" })).toBeVisible();
	expect((await env.checkpoint("second"))!.activeRevision).toBe(revision);
});
