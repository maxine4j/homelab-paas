import { expect, test, type Page } from "@playwright/test";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const head = "a".repeat(40);
const parent = "b".repeat(40);
const older = "c".repeat(40);
const date = "2026-11-02T00:00:00.000Z";
const code = `/projects/${projectId}/code`;
const metadata = (sha: string) => ({ sha, subject: `Commit ${sha.slice(0, 7)}`, author: "Owner", date });
const detail = (sha: string) => ({
	...metadata(sha),
	body: "Commit body <script>window.executed=true</script>",
	parents: sha === parent ? [] : [parent],
	comparisonBase: sha === parent ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904" : parent,
	omittedFiles: 0,
	totalsComplete: true,
	metadataTruncated: false,
	files:
		sha === parent
			? []
			: [
					{
						oldPath: "README.md",
						newPath: "README.md",
						oldMode: "100644",
						newMode: "100755",
						status: "modified",
						additions: 1,
						deletions: 1,
						binary: false,
						unsupported: false,
						truncated: false,
						hunks: [
							{
								oldStart: 1,
								oldCount: 2,
								newStart: 1,
								newCount: 2,
								lines: [
									{ kind: "context", text: "hello", oldLine: 1, newLine: 1 },
									{ kind: "deletion", text: "old", oldLine: 2 },
									{
										kind: "addition",
										text: "<img src=x onerror=window.executed=true>" + "x".repeat(1500),
										newLine: 2,
									},
									{ kind: "no-newline", text: "No newline at end of file" },
								],
							},
						],
					},
				],
});
const setup = async (page: Page) => {
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const url = new URL(route.request().url());
			const path = url.pathname;
			const json = (value: unknown) => route.fulfill({ json: value });
			if (path === "/api/projects")
				return json([{ id: projectId, name: "Forge", status: "ready", createdAt: date }]);
			if (path === "/api/accounts")
				return json({
					codex: { connection: "available", login: { state: "idle" } },
					github: { connection: "available", login: { state: "idle" } },
				});
			if (path.endsWith("/branches")) return json([{ name: "main", sha: head }]);
			if (path.endsWith("/tree"))
				return json({
					path: "",
					head,
					entries: [{ name: "README.md", path: "README.md", kind: "file", lastCommit: metadata(head) }],
					truncated: false,
				});
			if (path.endsWith("/file")) return json({ path: "README.md", content: "# Original" });
			if (path.endsWith("/history"))
				return json({
					head,
					commits:
						url.searchParams.get("offset") === "0"
							? Array.from({ length: 30 }, (_, i) =>
									metadata(i === 0 ? head : i.toString(16).padStart(40, "0")),
								)
							: [metadata(older)],
					hasMore: url.searchParams.get("offset") === "0",
				});
			if (path.includes("/commits/")) return json(detail(path.split("/").at(-1)!));
			return json([]);
		},
	);
};
test.beforeEach(async ({ page }) => {
	await setup(page);
});

test("real commit links, pagination, parent navigation and Back/Forward retain history", async ({ page }) => {
	await page.goto(`${code}?branch=main&view=history`);
	await page.getByRole("button", { name: "Load more commits" }).click();
	const link = page.getByRole("link", { name: "Commit ccccccc", exact: true });
	await expect(link).toHaveAttribute("href", /view=commit&commit=cccccccccccccccccccccccccccccccccccccccc/);
	await link.scrollIntoViewIfNeeded();
	const scroll = await page.evaluate(() => window.scrollY);
	await link.click();
	await expect(page.getByRole("heading", { name: "Commit ccccccc", exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Parent bbbbbbb" }).click();
	await expect(page.getByText("No file changes", { exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Commit ccccccc", exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole("link", { name: "Commit ccccccc", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Commit history" }).locator("article")).toHaveCount(31);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
	await page.goForward();
	await expect(page.getByRole("heading", { name: "Commit ccccccc", exact: true })).toBeVisible();
});

test("deep links work without a contextual branch or branch list and restore mode/file anchors on reload", async ({
	page,
}) => {
	await page.route("**/repository/branches", (route) =>
		route.fulfill({ status: 503, json: { error: "workspace-unavailable" } }),
	);
	await page.goto(`${code}?branch=deleted&view=commit&commit=${head}&diff=split#diff-0`);
	await expect(page.getByRole("heading", { name: "Commit aaaaaaa", exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Split", exact: true })).toHaveAttribute("aria-current", "true");
	await expect(page.locator("#diff-0")).toBeVisible();
	await page.reload();
	await expect(page.locator("#diff-0")).toBeVisible();
	await page.getByRole("link", { name: "Unified", exact: true }).click();
	expect(new URL(page.url()).searchParams.get("diff")).toBeNull();
	await page.goBack();
	expect(new URL(page.url()).searchParams.get("diff")).toBe("split");
	await page.getByRole("link", { name: "Files", exact: true }).click();
	expect(new URL(page.url()).searchParams.has("commit")).toBe(false);
});

test("file navigation, collapse, split lines, clipboard feedback and mobile overflow are safe", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(`${code}?view=commit&commit=${head}`);
	await expect(page.getByText("No newline at end of file", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "README.md", exact: true }).click();
	expect(new URL(page.url()).hash).toBe("#diff-0");
	await page.getByRole("tab", { name: "Pipelines", exact: true }).click();
	await page.getByRole("tab", { name: "Code", exact: true }).click();
	expect(new URL(page.url()).hash).toBe("#diff-0");
	await page.getByRole("button", { name: "Copy full SHA" }).click();
	await expect(page.getByRole("status")).toHaveText("SHA copied");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(head);
	await page.getByRole("link", { name: "Split", exact: true }).click();
	await expect(page.locator(".commit-diff.split")).toBeVisible();
	await page.getByRole("button", { name: "Collapse README.md" }).click();
	await expect(page.getByText("No newline at end of file", { exact: true })).toBeHidden();
	await page.getByRole("button", { name: "Expand README.md" }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	const title = await page.getByRole("heading", { name: "Commit aaaaaaa", exact: true }).boundingBox();
	expect(title?.width).toBeGreaterThan(250);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(await page.evaluate(() => "executed" in window)).toBe(false);
	await expect(page.locator(".commit-view img, .commit-view script")).toHaveCount(0);
});

test("directory subjects and history SHAs can be copied and opened in new tabs", async ({ page, context }) => {
	await page.goto(code);
	const link = page.getByRole("link", { name: "Commit aaaaaaa", exact: true });
	const href = await link.getAttribute("href");
	expect(href).toContain(`commit=${head}`);
	const tab = await context.newPage();
	await setup(tab);
	await tab.goto(href!);
	await expect(tab.getByRole("heading", { name: "Commit aaaaaaa", exact: true })).toBeVisible();
	await tab.close();
	await page.getByRole("button", { name: "Commit history" }).click();
	await expect(page.getByRole("link", { name: "aaaaaaa", exact: true })).toHaveAttribute(
		"href",
		href!.replace("?view=commit", "?branch=main&view=commit"),
	);
});

test("returning to history refreshes a changed head explicitly and never mixes pagination", async ({ page }) => {
	await page.goto(`${code}?branch=main&view=history`);
	await page.getByRole("button", { name: "Load more commits" }).click();
	await page.getByRole("link", { name: "Commit ccccccc", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Commit ccccccc", exact: true })).toBeVisible();
	await page.route(
		(url) => url.pathname.endsWith("/repository/history"),
		(route) =>
			route.fulfill({ json: { head: "d".repeat(40), commits: [metadata("d".repeat(40))], hasMore: false } }),
	);
	await page.goBack();
	await expect(page.getByRole("link", { name: "Commit ddddddd", exact: true })).toBeVisible();
	await expect(page.getByRole("status")).toContainText("Branch changed");
	await expect(page.getByRole("region", { name: "Commit history" }).locator("article")).toHaveCount(1);
});

test("drafts and commit messages survive commit, sections and Config navigation", async ({ page }) => {
	await page.goto(code);
	await page.getByRole("button", { name: "README.md", exact: true }).click();
	await page.locator(".cm-content").fill("local draft");
	await page.getByRole("textbox", { name: "Commit message" }).fill("Retained message");
	await page.getByRole("button", { name: "Commit history" }).click();
	await page.getByRole("link", { name: "Commit aaaaaaa", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Commit message" })).toBeHidden();
	await page.getByRole("tab", { name: "Pipelines", exact: true }).click();
	await page.getByRole("tab", { name: "Code", exact: true }).click();
	await page.getByRole("link", { name: "Config", exact: true }).click();
	await page.goBack();
	await page.getByRole("link", { name: "Files", exact: true }).click();
	await expect(page.locator(".cm-content")).toHaveText("local draft");
	await expect(page.getByRole("textbox", { name: "Commit message" })).toHaveValue("Retained message");
});

test("malformed selections, missing/access/unavailable errors and retry are explicit", async ({ page }) => {
	await page.goto(`${code}?view=commit&commit=main`);
	await expect(page.getByRole("alert")).toContainText("Invalid commit selection");
	for (const [error, status, text] of [
		["commit-not-found", 404, "Commit not found"],
		["access-denied", 403, "configured owner"],
		["workspace-unavailable", 503, "unavailable"],
	] as const) {
		await page.route("**/repository/commits/*", (route) => route.fulfill({ status, json: { error } }));
		await page.goto(`${code}?view=commit&commit=${head}`);
		await expect(page.getByRole("alert")).toContainText(text);
		await page.unroute("**/repository/commits/*");
		await page.getByRole("button", { name: "Retry commit" }).click();
		await expect(page.getByRole("heading", { name: "Commit aaaaaaa", exact: true })).toBeVisible();
	}
});

test("late commit responses cannot replace a newer selection and clipboard rejection has feedback", async ({
	page,
}) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(`**/repository/commits/${head}`, async (route) => {
		await gate;
		await route.fulfill({ json: detail(head) });
	});
	await page.goto(`${code}?view=commit&commit=${head}`);
	await expect(page.getByText("Loading commit…", { exact: true })).toBeVisible();
	await page.evaluate((href) => {
		window.history.pushState({}, "", href);
		dispatchEvent(new PopStateEvent("popstate"));
	}, `${code}?view=commit&commit=${older}`);
	await expect(page.getByRole("heading", { name: "Commit ccccccc", exact: true })).toBeVisible();
	release();
	await expect(page.getByRole("heading", { name: "Commit aaaaaaa", exact: true })).toHaveCount(0);
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: () => Promise.reject(new Error("Denied")) },
		});
	});
	await page.getByRole("button", { name: "Copy full SHA" }).click();
	await expect(page.getByRole("status")).toContainText("Copy failed");
});
