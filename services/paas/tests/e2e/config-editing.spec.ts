import type { PlatformConfig } from "../../src/config/types.ts";
import { readFile } from "../../src/util/file.ts";
import { parseYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";

test("browser edits configuration on the host and consumers immediately see saved settings", async ({
	environment: env,
	page,
}) => {
	await page.goto(env.url("", "/#/cluster"));
	await expect(page.getByRole("button", { name: "Save configuration" })).toBeVisible();
	const secret = page.getByLabel("auth.github.clientSecret", { exact: true });
	await expect(secret).toHaveValue("");
	await expect(secret).toHaveAttribute("type", "password");
	const poll = page.getByLabel("git.pollIntervalSeconds", { exact: true });
	await poll.fill("7");
	// An automatic snapshot refresh must not discard a dirty draft.
	const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/ui/cluster"));
	await page.getByRole("button", { name: "Refresh", exact: false }).click();
	expect((await refreshed).status()).toBe(200);
	await expect(poll).toHaveValue("7");
	await secret.fill("replacement-github-secret");
	await page.getByRole("button", { name: "Save configuration" }).click();
	await expect(page.getByRole("status")).toHaveText("Configuration saved");
	await expect(secret).toHaveValue("");
	const persisted = parseYaml(
		(await readFile(`${env.directory}/etc/config.yaml`))!,
		"saved config",
	) as PlatformConfig;
	expect(persisted.git.pollIntervalSeconds).toBe(7);
	expect(persisted.auth?.github.clientSecret).toBe("replacement-github-secret");
	expect(persisted.auth?.session.signingKey).toBe(env.config.auth?.session.signingKey);
	const response = await env.request(env.url("", "/api/ui/cluster"), `__Secure-paas_session=${env.session()}`);
	const snapshot = await response.json();
	expect(snapshot.config.git.pollIntervalSeconds).toBe(7);
	expect(JSON.stringify(snapshot)).not.toContain("replacement-github-secret");
	// Reload from the saved host file, including across process recreation.
	await env.compose(["restart", "paas"]);
	await env.waitReady("public", "v1");
	await page.reload();
	await expect(poll).toHaveValue("7");
	await expect(secret).toHaveValue("");
});

test("the editor preserves failed drafts and requires a reload after another editor saves", async ({
	environment: env,
	page,
	context,
}) => {
	await page.goto(env.url("", "/#/cluster"));
	await expect(page.getByRole("button", { name: "Save configuration" })).toBeVisible();
	const other = await context.newPage();
	await other.goto(env.url("", "/#/cluster"));
	await other.getByLabel("git.operationTimeoutSeconds", { exact: true }).fill("13");
	await page.getByLabel("git.operationTimeoutSeconds", { exact: true }).fill("11");
	await page.getByRole("button", { name: "Save configuration" }).click();
	await expect(page.getByRole("status")).toHaveText("Configuration saved");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Configuration changed");
	await expect(other.getByLabel("git.operationTimeoutSeconds", { exact: true })).toHaveValue("13");
	await other.getByRole("button", { name: "Reload configuration" }).click();
	await expect(other.getByLabel("git.operationTimeoutSeconds", { exact: true })).toHaveValue("11");
	await other.getByLabel("services", { exact: true }).fill("{invalid");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Services must contain valid JSON");
	await expect(other.getByLabel("services", { exact: true })).toHaveValue("{invalid");
	await other.getByRole("button", { name: "Reload configuration" }).click();
	await expect(other.getByLabel("services", { exact: true })).not.toHaveValue("{invalid");
	await other.getByLabel("reconciliation.retryBackoffSeconds", { exact: true }).fill("99");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Invalid configuration");
	await expect(other.getByLabel("reconciliation.retryBackoffSeconds", { exact: true })).toHaveValue("99");
	const persisted = parseYaml(
		(await readFile(`${env.directory}/etc/config.yaml`))!,
		"unchanged config",
	) as PlatformConfig;
	expect(persisted.reconciliation.retryBackoffSeconds).toBe(1);
	expect(persisted.auth?.github.clientSecret).toBe(env.config.auth?.github.clientSecret);
});
