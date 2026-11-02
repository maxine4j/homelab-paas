import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import { mkdir } from "../../src/util/file.ts";
import { parseYaml, stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("manual pause blocks web and static ingress through Git refresh and restart until Resume", async ({
	environment: env,
	page,
}) => {
	const descriptor = parseYaml(await env.descriptor("public", "v1"), "descriptor") as ServiceDescriptor;
	const app = descriptor.resources["app"];
	if (!app || app.type !== "web") throw new Error("Expected web fixture");
	app.primary = true;
	descriptor.resources["site"] = { type: "static", path: "bundle", ingress: { public: true } };
	await mkdir(`${env.git.work}/bundle`, { recursive: true });
	const first = await env.git.commit({
		"public.sd.yaml": stringifyYaml(descriptor),
		"bundle/index.html": "first bundle",
	});
	await waitFor("mixed service ready", async () => (await env.checkpoint("public"))?.activeRevision === first);
	await page.goto(env.url("", "/#/services/public"));
	await expect(page.getByLabel("Health: Healthy", { exact: true }).first()).toBeVisible();
	const pauseResponse = page.waitForResponse((response) => response.url().endsWith("/api/ui/services/public/pause"));
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	expect((await pauseResponse).status()).toBe(204);
	await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
	const pill = page.locator(".service-identity").getByLabel("Health: Paused", { exact: true });
	await expect(pill).toBeVisible();
	await expect(pill).toHaveCSS("color", "rgb(196, 160, 245)");
	await expect(page.getByRole("button", { name: "Redeploy", exact: true })).toBeDisabled();
	for (const host of ["public", "app.public", "site.public"])
		expect((await env.request(env.url(host))).status).toBe(404);
	descriptor.metadata.description = "New commit while paused";
	const next = await env.git.commit({
		"public.sd.yaml": stringifyYaml(descriptor),
		"bundle/index.html": "second bundle",
	});
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "Git refresh complete" })).toBeVisible();
	await expect(page.locator(".service-identity").getByLabel("Sync: OutOfSync", { exact: true })).toBeVisible();
	expect((await env.checkpoint("public"))?.activeRevision).toBe(first);
	await env.compose(["restart", "paas"]);
	await waitFor("paused management snapshot after restart", async () => {
		const response = await env.request(
			env.url("", "/api/ui/services/public"),
			`__Secure-paas_session=${env.session()}`,
		);
		return response.status === 200 && (await response.json()).health === "Paused";
	});
	await page.reload();
	await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
	for (const host of ["public", "app.public", "site.public"])
		expect((await env.request(env.url(host))).status).toBe(404);
	const resumeResponse = page.waitForResponse((response) =>
		response.url().endsWith("/api/ui/services/public/resume"),
	);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	expect((await resumeResponse).status()).toBe(204);
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
	expect((await env.checkpoint("public"))?.activeRevision).toBe(next);
	await env.waitReady("public", "v1");
	expect((await env.request(env.url("public", "/version"))).status).toBe(200);
	await waitFor(
		"static ingress resumes",
		async () => (await (await env.request(env.url("site.public"))).text()) === "second bundle",
	);
});

test("wrapped service actions share the full row while wide headings keep compact actions", async ({
	environment: env,
	page,
}) => {
	await page.goto(env.url("", "/#/services/public"));
	const heading = page.locator(".service-identity-block");
	await expect(heading.getByRole("button", { name: "Redeploy", exact: true })).toBeVisible();
	await expect(heading.getByLabel("Health: Healthy", { exact: true })).toBeVisible();
	for (const width of [320, 390, 600, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await heading.getByRole("heading").evaluate(
			(element, name) => {
				element.textContent = name;
			},
			width === 600 ? "public-service-with-a-long-name" : "public",
		);
		const layout = await heading.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			const identity = element.querySelector(".service-identity")!.getBoundingClientRect();
			const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
			const [refresh, redeploy, pause] = buttons;
			return {
				left: bounds.left,
				right: bounds.right,
				identityBottom: identity.bottom,
				refresh: { left: refresh!.left, top: refresh!.top, width: refresh!.width },
				redeploy: { right: redeploy!.right, top: redeploy!.top, width: redeploy!.width },
				pause: { right: pause!.right, top: pause!.top, width: pause!.width },
				gap: redeploy!.left - refresh!.right,
				pageFits: document.documentElement.scrollWidth <= window.innerWidth,
			};
		});
		expect(layout.pageFits).toBe(true);
		expect(layout.refresh.width).toBeCloseTo(layout.redeploy.width, 0);
		expect(layout.refresh.top).toBe(layout.redeploy.top);
		expect(layout.pause.top).toBe(layout.refresh.top);
		expect(layout.pause.width).toBeCloseTo(layout.refresh.width, 0);
		expect(layout.gap).toBe(12);
		expect(layout.left).toBeGreaterThanOrEqual(20);
		expect(width - layout.right).toBeGreaterThanOrEqual(20);
		if (width < 1280) {
			expect(layout.refresh.top).toBeGreaterThanOrEqual(layout.identityBottom + 8);
			expect(layout.refresh.left).toBeCloseTo(layout.left, 0);
			expect(layout.pause.right).toBeCloseTo(layout.right, 0);
		} else {
			expect(layout.refresh.top).toBeLessThan(layout.identityBottom);
			expect(layout.refresh.width).toBeLessThan(160);
		}
	}
});
