import { expect, test } from "@playwright/test";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const id = "123e4567-e89b-42d3-a456-426614174001";
const date = "2026-11-02T00:00:00.000Z";
const head = "a".repeat(40);
const commit = { sha: head, subject: "Add documentation", author: "Owner", date };
const entries = [
	{ name: "src", path: "src", kind: "directory" },
	{ name: "README.md", path: "README.md", kind: "file" },
	...Array.from({ length: 12 }, (_, i) => ({ name: `file-${i}.ts`, path: `file-${i}.ts`, kind: "file" })),
].map((e) => ({ ...e, lastCommit: commit, lastChangedAt: date }));

test.beforeEach(async ({ page }) => {
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const url = new URL(route.request().url());
			const path = url.pathname;
			const json = (value: unknown) => route.fulfill({ json: value });
			if (path === "/api/projects")
				return json([{ id: projectId, name: "Forge", status: "ready", createdAt: date }]);
			if (path.endsWith("/workspaces"))
				return json([
					{
						id,
						projectId,
						name: "Project files",
						branch: `forge/workspace/${id}`,
						head,
						baseSha: head,
						createdAt: date,
						status: "ready",
					},
				]);
			if (path.endsWith("/branches"))
				return json([
					{ name: "main", sha: head },
					{ name: "feature", sha: "b".repeat(40) },
				]);
			if (path.endsWith("/history"))
				return json({
					head,
					commits: [{ ...commit, subject: `${url.searchParams.get("branch")} commit` }],
					hasMore: false,
				});
			if (path.endsWith("/tree")) {
				const dir = url.searchParams.get("path") ?? "";
				const values = dir
					? [
							{
								name: "index.ts",
								path: "src/index.ts",
								kind: "file",
								lastChangedAt: date,
								lastCommit: commit,
							},
						]
					: entries;
				return json(
					path.includes("/repository/")
						? {
								head,
								path: dir,
								entries: values.map(({ name, path, kind, lastCommit }) => ({
									name,
									path,
									kind,
									lastCommit,
								})),
								truncated: false,
							}
						: {
								path: dir,
								entries: values.map(({ name, path, kind, lastChangedAt }) => ({
									name,
									path,
									kind,
									lastChangedAt,
								})),
								truncated: false,
							},
				);
			}
			if (path.endsWith("/file")) {
				const file = url.searchParams.get("path") ?? "";
				const content =
					file === "README.md" ? "# Forge documentation\n\nA useful project." : "export const value = 1;";
				return json(
					path.includes("/repository/")
						? { path: file, content }
						: { path: file, content, version: "1".repeat(64) },
				);
			}
			if (path.endsWith("/diff")) {
				const empty = { files: [], patch: "", truncated: false };
				return json({
					head,
					baseSha: head,
					comparison: "merge-base(main, workspace)..workspace",
					branch: empty,
					staged: empty,
					unstaged: empty,
					untracked: empty,
				});
			}
			if (path.endsWith("/pull-requests")) return json([]);
			return route.fulfill({ status: 404, json: {} });
		},
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Open Forge" }).click();
});

test("Code overview limits entries, renders README and dates, and opens the editor only on file selection", async ({
	page,
}) => {
	await expect(page.getByRole("tab", { name: "Code", exact: true })).toHaveAttribute("aria-selected", "true");
	const list = page.getByRole("table", { name: "Repository files" });
	await expect(list.getByRole("row")).toHaveCount(11);
	await expect(list.locator("time")).toHaveCount(10);
	await expect(list.locator("svg[data-file-type=typescript]").first()).toBeVisible();
	await expect(page.getByRole("textbox", { name: "File editor" })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "README" })).toContainText("Forge documentation");
	for (const width of [1280, 820, 390]) {
		await page.setViewportSize({ width, height: 900 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: `../../../../artifacts/forge/code-overview-${width}.png`, fullPage: true });
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.getByRole("button", { name: "Show all 14 files" }).click();
	await expect(list.getByRole("row")).toHaveCount(15);
	await list.getByRole("button", { name: "file-0.ts", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "File editor" })).toBeVisible();
	await expect(list).toHaveCount(0);
	await page.getByRole("button", { name: "Back to files", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "File editor" })).toHaveCount(0);
	await expect(list).toBeVisible();
	await list.getByRole("button", { name: "src", exact: true }).click();
	await expect(list.getByRole("button", { name: "index.ts", exact: true })).toBeVisible();
});

test("directory listings have named columns, repository breadcrumbs and a parent entry without file creation", async ({
	page,
}) => {
	const list = page.getByRole("table", { name: "Repository files" });
	const breadcrumb = page.getByRole("navigation", { name: "File path" });
	await expect(list.getByRole("columnheader")).toHaveText(["Name", "Last commit message", "Last commit date"]);
	await expect(breadcrumb.getByRole("button", { name: "Forge", exact: true })).toBeVisible();
	await expect(list.getByRole("button", { name: "..", exact: true })).toHaveCount(0);
	await expect(page.getByText("New file", { exact: true })).toHaveCount(0);
	await list.getByRole("button", { name: "src", exact: true }).click();
	await expect(breadcrumb).toHaveText("Forge / src");
	await expect(list.getByRole("columnheader")).toHaveText(["Name", "Last commit message", "Last commit date"]);
	const parent = list.getByRole("button", { name: "..", exact: true });
	await expect(parent.locator("svg[data-file-type=folder]")).toBeVisible();
	await parent.click();
	await expect(list.getByRole("button", { name: "src", exact: true })).toBeVisible();
	await list.getByRole("button", { name: "src", exact: true }).click();
	await breadcrumb.getByRole("button", { name: "Forge", exact: true }).click();
	await expect(list.getByRole("button", { name: "src", exact: true })).toBeVisible();
});

test("branch dropdown scopes code and history; committed code can be drafted", async ({ page }) => {
	await page.getByRole("combobox", { name: "Branch" }).selectOption("feature");
	await page.getByRole("button", { name: "Commit history" }).click();
	await expect(page.getByRole("region", { name: "Commit history" })).toContainText("feature commit");
	await page.getByRole("combobox", { name: "Branch" }).selectOption("main");
	await page.getByRole("button", { name: "Commit history" }).click();
	await expect(page.getByRole("region", { name: "Commit history" })).toContainText("main commit");
	await page.getByRole("button", { name: "Back to files", exact: true }).click();
	await page
		.getByRole("table", { name: "Repository files" })
		.getByRole("button", { name: "file-0.ts", exact: true })
		.click();
	await expect(page.getByRole("textbox", { name: "File editor" })).toHaveAttribute("contenteditable", "true");
	await expect(page.getByRole("button", { name: "Save file", exact: true })).toHaveCount(0);
});

test("file tree is visible on Pixel Tablet and laptops, hidden on slab phones with no page overflow", async ({
	page,
}) => {
	await page
		.getByRole("table", { name: "Repository files" })
		.getByRole("button", { name: "file-0.ts", exact: true })
		.click();
	for (const width of [1280, 1024, 820, 390]) {
		await page.setViewportSize({ width, height: 900 });
		const tree = page.getByRole("complementary", { name: "File tree" });
		if (width > 600) await expect(tree).toBeVisible();
		else await expect(tree).toBeHidden();
		await expect(page.getByRole("textbox", { name: "File editor" })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: `../../../../artifacts/forge/code-${width}.png`, fullPage: true });
	}
});

test("left file tree expands folders while keeping the open editor and drafts", async ({ page }) => {
	await page
		.getByRole("table", { name: "Repository files" })
		.getByRole("button", { name: "file-0.ts", exact: true })
		.click();
	const editor = page.getByRole("textbox", { name: "File editor" });
	await editor.fill("const draft = 42;");
	const tree = page.getByRole("complementary", { name: "File tree" });
	await tree.getByRole("button", { name: "Open src", exact: true }).click();
	await expect(editor).toContainText("const draft = 42;");
	await expect(tree.getByRole("button", { name: "Open src", exact: true })).toHaveAttribute("aria-expanded", "true");
	await tree.getByRole("button", { name: "Open index.ts", exact: true }).click();
	await expect(editor).toContainText("export const value = 1;");
	await expect(page.getByRole("navigation", { name: "File path" })).toHaveText("Forge / src / index.ts");
	await page.getByRole("combobox", { name: "Branch" }).selectOption("feature");
	await page.getByRole("combobox", { name: "Branch" }).selectOption("main");
	await page
		.getByRole("tablist", { name: "Editor tabs" })
		.getByRole("tab", { name: "file-0.ts *", exact: true })
		.click();
	await expect(editor).toContainText("const draft = 42;");
});

test("a delayed sidebar read stays scoped to its original branch", async ({ page }) => {
	await page.getByRole("combobox", { name: "Branch" }).selectOption("main");
	await page
		.getByRole("table", { name: "Repository files" })
		.getByRole("button", { name: "file-0.ts", exact: true })
		.click();
	let release: (() => void) | undefined;
	let requested = false;
	await page.route("**/repository/file?*file-1.ts", async (route) => {
		requested = true;
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ json: { path: "file-1.ts", content: "export const next = true;" } });
	});
	await page
		.getByRole("complementary", { name: "File tree" })
		.getByRole("button", { name: "Open file-1.ts", exact: true })
		.click();
	await expect.poll(() => requested).toBe(true);
	try {
		await page.getByRole("combobox", { name: "Branch" }).selectOption("feature");
	} finally {
		release?.();
	}
	await page.getByRole("combobox", { name: "Branch" }).selectOption("main");
	await expect(page.getByRole("textbox", { name: "File editor" })).toContainText("export const next = true;");
});
