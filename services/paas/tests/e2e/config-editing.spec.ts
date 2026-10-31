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
	const summary = page.getByRole("region", { name: "Cluster details", exact: true });
	await expect(summary).toContainText(env.config.metadata.clusterId);
	await expect(summary).toContainText(env.config.ingress.baseDomain);
	await expect(summary).toContainText(String(env.config.ingress.httpPort));
	await expect(summary).toContainText(String(env.config.ingress.httpsPort));
	await expect(summary.locator("input")).toHaveCount(0);
	await expect(page.getByRole("region", { name: "auth.github", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "auth.session", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "tls.acme", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("version", { exact: true })).toHaveCount(0);
	const poll = page
		.getByRole("region", { name: "git", exact: true })
		.getByLabel("pollIntervalSeconds", { exact: true });
	await poll.fill("7");
	// Reconnecting after a control-plane restart must not discard a dirty draft.
	let snapshots = 0;
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const message = JSON.parse(String(payload)) as { type: string; target?: { kind: string } };
			if (message.type === "snapshot" && message.target?.kind === "cluster") snapshots++;
		});
	});
	await env.compose(["restart", "paas"]);
	await env.waitReady("public", "v1");
	await expect.poll(() => snapshots).toBeGreaterThan(0);
	await expect(poll).toHaveValue("7");
	await page.getByRole("button", { name: "Save configuration" }).click();
	await expect(page.getByRole("status")).toHaveText("Configuration saved");
	const persisted = parseYaml(
		(await readFile(`${env.directory}/etc/config.yaml`))!,
		"saved config",
	) as PlatformConfig;
	expect(persisted.git.pollIntervalSeconds).toBe(7);
	expect(persisted.auth?.github.clientSecret).toBe(env.config.auth?.github.clientSecret);
	expect(persisted.auth?.session.signingKey).toBe(env.config.auth?.session.signingKey);
	const response = await env.request(env.url("", "/api/ui/cluster"), `__Secure-paas_session=${env.session()}`);
	const snapshot = await response.json();
	expect(snapshot.config.git.pollIntervalSeconds).toBe(7);
	expect(JSON.stringify(snapshot)).not.toContain(env.config.auth!.github.clientSecret);
	// Reload from the saved host file, including across process recreation.
	await env.compose(["restart", "paas"]);
	await env.waitReady("public", "v1");
	await page.reload();
	await expect(poll).toHaveValue("7");
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
	const timeout = page
		.getByRole("region", { name: "git", exact: true })
		.getByLabel("operationTimeoutSeconds", { exact: true });
	const otherTimeout = other
		.getByRole("region", { name: "git", exact: true })
		.getByLabel("operationTimeoutSeconds", { exact: true });
	await otherTimeout.fill("13");
	await timeout.fill("11");
	await page.getByRole("button", { name: "Save configuration" }).click();
	await expect(page.getByRole("status")).toHaveText("Configuration saved");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Configuration changed");
	await expect(otherTimeout).toHaveValue("13");
	await other.getByRole("button", { name: "Reload configuration" }).click();
	await expect(otherTimeout).toHaveValue("11");
	const repository = other
		.getByRole("group", { name: "second", exact: true })
		.getByLabel("Repository", { exact: true });
	await repository.fill("   ");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Repository is required for second");
	await expect(repository).toHaveValue("   ");
	await other.getByRole("button", { name: "Reload configuration" }).click();
	await expect(repository).toHaveValue(env.config.services["second"]!.remote);
	const retryBackoff = other
		.getByRole("region", { name: "reconciliation", exact: true })
		.getByLabel("retryBackoffSeconds", { exact: true });
	await retryBackoff.fill("99");
	await other.getByRole("button", { name: "Save configuration" }).click();
	await expect(other.getByRole("alert")).toContainText("Invalid configuration");
	await expect(retryBackoff).toHaveValue("99");
	const persisted = parseYaml(
		(await readFile(`${env.directory}/etc/config.yaml`))!,
		"unchanged config",
	) as PlatformConfig;
	expect(persisted.reconciliation.retryBackoffSeconds).toBe(1);
	expect(persisted.auth?.github.clientSecret).toBe(env.config.auth?.github.clientSecret);
});
