import { test, expect } from "../util/browser-fixtures.ts";

test("authenticated Envoy pushes deployment snapshots/events and follows new Docker log output without polling", async ({
	environment: env,
	page,
}) => {
	const frames: unknown[] = [];
	const reads: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (request.method() === "GET" && path.startsWith("/api/ui/") && path !== "/api/ui/live") reads.push(path);
	});
	page.on("websocket", (socket) =>
		socket.on("framereceived", ({ payload }) => {
			try {
				frames.push(JSON.parse(String(payload)));
			} catch {
				/* Non-JSON frames are asserted by protocol unit tests. */
			}
		}),
	);
	await page.goto(env.url("", "/#/services/public"));
	await expect(page.getByText("Live · connected", { exact: true })).toBeVisible();
	const identity = page.locator(".service-identity");
	await expect(identity.getByLabel("Health: Healthy", { exact: true })).toHaveCSS("color", "rgb(24, 190, 148)", {
		timeout: 40_000,
	});
	await expect(identity.getByLabel("Sync: Synced", { exact: true })).toBeVisible();
	for (const width of [320, 390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(identity.getByLabel("Health: Healthy", { exact: true })).toBeVisible();
		await expect(identity.getByLabel("Sync: Synced", { exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
	const revision = await env.update("public", "live-v2");
	await expect.poll(() => JSON.stringify(frames)).toContain('"event":"deployment.started"');
	await env.waitReady("public", "live-v2");
	await expect.poll(() => JSON.stringify(frames)).toContain('"event":"deployment.succeeded"');
	await expect(
		page.locator(".service-revision").filter({ hasText: "Active revision" }).getByTitle(revision, { exact: true }),
	).toHaveText(revision.slice(0, 7), { timeout: 40_000 });
	await page.goto(env.url("", "/#/services/public/resources/app/logs"));
	const logs = page.getByLabel("Container logs", { exact: true });
	await expect(logs).toBeVisible();
	const container = (await env.workloadIds("public")).at(0)!;
	await env.docker(["exec", container, "sh", "-c", "printf 'stream-arrived-one\\n' > /proc/1/fd/1"]);
	await expect(logs).toContainText("stream-arrived-one");
	await page.getByRole("button", { name: "Pause follow", exact: true }).click();
	await env.docker(["exec", container, "sh", "-c", "printf 'stream-arrived-two\\n' > /proc/1/fd/1"]);
	await expect.poll(() => JSON.stringify(frames)).toContain("stream-arrived-two");
	await expect(logs).not.toContainText("stream-arrived-two");
	await page.getByRole("button", { name: "Resume follow", exact: true }).click();
	await expect(logs).toContainText("stream-arrived-two");
	await page.getByRole("button", { name: "Pause follow", exact: true }).click();
	await page.evaluate(() => {
		window.location.hash = "#/services/second/resources/app/logs";
	});
	await expect(page.getByRole("button", { name: "Pause follow", exact: true })).toBeVisible();
	await expect(page.getByLabel("Container logs", { exact: true })).not.toContainText("stream-arrived-one");
	await page.goto(env.url("", "/#/services/public/events"));
	await env.git.commit({ "public.sd.yaml": "version: 999\n" });
	await expect.poll(() => JSON.stringify(frames)).toContain('"event":"reconciliation.failed"');
	await expect(
		page
			.getByText("Invalid service descriptor: check service identity and resource configuration", { exact: true })
			.first(),
	).toBeVisible();
	expect(reads).toEqual([]);
});

test("failed surge shows Progressing in blue then preserves Healthy with OutOfSync", async ({
	environment: env,
	page,
}) => {
	await page.goto(env.url("", "/#/services/public"));
	const identity = page.locator(".service-identity");
	await expect(identity.getByLabel("Health: Healthy", { exact: true })).toBeVisible({ timeout: 40_000 });
	await env.update("public", "unready", "surge", false);
	await expect(identity.getByLabel("Health: Progressing", { exact: true })).toHaveCSS("color", "rgb(13, 173, 234)", {
		timeout: 40_000,
	});
	await expect(identity.getByLabel("Sync: OutOfSync", { exact: true })).toHaveCSS("color", "rgb(244, 192, 48)");
	await expect(identity.getByLabel("Health: Healthy", { exact: true })).toBeVisible({ timeout: 60_000 });
	await expect(identity.getByLabel("Sync: OutOfSync", { exact: true })).toBeVisible();
	expect((await env.checkpoint("public"))?.phase).toBe("deploying");
});
