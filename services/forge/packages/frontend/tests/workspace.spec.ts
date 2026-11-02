import { expect, test } from "@playwright/test";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const id = "123e4567-e89b-42d3-a456-426614174001";
const head = "a".repeat(40);
const workspace = {
	id,
	projectId,
	name: "Manual",
	branch: `forge/workspace/${id}`,
	head,
	baseSha: head,
	status: "ready",
	createdAt: "2026-11-02T00:00:00.000Z",
};
const empty = { files: [], patch: "", truncated: false };

test("file changes show four comparisons and commit uses the displayed head", async ({ page }) => {
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => route.fulfill({ json: [workspace] }));
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({ json: { path: "", entries: [], truncated: false } }),
	);
	let staged = false;
	let committed = false;
	await page.route(`**/api/workspaces/${id}/diff`, (route) =>
		route.fulfill({
			json: {
				comparison: "merge-base(main, workspace)..workspace",
				baseSha: head,
				head,
				branch: empty,
				staged: staged ? { files: [{ path: "binary", binary: true }], patch: "", truncated: true } : empty,
				unstaged: empty,
				untracked: staged ? empty : { files: [{ path: "binary", binary: true }], patch: "", truncated: false },
			},
		}),
	);
	await page.route(`**/api/workspaces/${id}/stage`, (route) => {
		expect(route.request().postDataJSON()).toEqual({ paths: ["binary"] });
		staged = true;
		return route.fulfill({ json: workspace });
	});
	await page.route(`**/api/workspaces/${id}/unstage`, (route) => {
		staged = false;
		return route.fulfill({ json: workspace });
	});
	await page.route(`**/api/workspaces/${id}/commit`, (route) => {
		expect(route.request().postDataJSON()).toEqual({ message: "Add binary", expectedHead: head });
		committed = true;
		return route.fulfill({ json: workspace });
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByText("Changes", { exact: true }).first().click();
	await expect(page.getByRole("heading", { name: "Untracked", exact: true })).toBeVisible({ timeout: 1000 });
	for (const name of ["Branch", "Staged", "Unstaged"])
		await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Stage binary", exact: true }).click();
	await expect(page.getByText("Diff truncated", { exact: true })).toBeVisible();
	await expect(page.getByText("binary · Binary", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Unstage binary", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stage binary", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Stage binary", exact: true }).click();
	await page.getByLabel("Commit message").fill("Add binary");
	await page.getByRole("button", { name: "Commit staged changes" }).click();
	expect(committed).toBe(true);
});

test("open project, edit tabs, retain unsaved content through conflict and navigation, explicitly recover", async ({
	page,
}) => {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				codex: { connection: "available", login: { state: "idle" } },
				github: { connection: "available", login: { state: "idle" } },
			},
		}),
	);
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => route.fulfill({ json: [workspace] }));
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => route.fulfill({ json: [] }));
	await page.route(`**/api/workspaces/${id}/terminal`, (route) => route.fulfill({ json: {} }));
	await page.route(`**/api/workspaces/${id}/diff`, (route) =>
		route.fulfill({
			json: {
				comparison: "merge-base(main, workspace)..workspace",
				baseSha: head,
				head,
				branch: empty,
				staged: empty,
				unstaged: empty,
				untracked: empty,
			},
		}),
	);
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({
			json: { path: "", entries: [{ name: "file.ts", path: "file.ts", kind: "file" }], truncated: false },
		}),
	);
	let conflict = true;
	let saves = 0;
	await page.route(`**/api/workspaces/${id}/file*`, (route) => {
		if (route.request().method() === "PUT") {
			saves++;
			expect(route.request().postDataJSON().version).toBe(conflict ? "1".repeat(64) : "2".repeat(64));
			return route.fulfill({
				status: conflict ? 409 : 200,
				json: conflict
					? { error: "file-conflict" }
					: { path: "file.ts", content: route.request().postDataJSON().content, version: "3".repeat(64) },
			});
		}
		return route.fulfill({
			json: {
				path: "file.ts",
				content: conflict ? "const value = 1;" : "const external = 2;",
				version: conflict ? "1".repeat(64) : "2".repeat(64),
			},
		});
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByRole("button", { name: "file.ts", exact: true }).click();
	const editor = page.getByRole("textbox", { name: "File editor" });
	await editor.fill("const local = 3;");
	await page.getByRole("button", { name: "Save file", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Your draft is preserved");
	await expect(editor).toContainText("const local = 3;");
	await page.getByRole("tab", { name: "Tasks", exact: true }).click();
	await page.getByRole("link", { name: "Config", exact: true }).click();
	await page.getByRole("link", { name: "Projects", exact: true }).click();
	await page.getByRole("tab", { name: "Files", exact: true }).click();
	await expect(editor).toContainText("const local = 3;");
	await page.getByRole("button", { name: "Projects", exact: true }).click();
	await expect(page.getByText("Unsaved edits remain")).toBeVisible();
	conflict = false;
	await page.getByRole("button", { name: "Compare server version" }).click();
	await expect(page.getByText("const external = 2;", { exact: true })).toBeVisible();
	await expect(editor).toContainText("const local = 3;");
	await page.getByRole("button", { name: "Use server version and discard draft" }).click();
	await expect(editor).toContainText("const external = 2;");
	await editor.fill("const resolved = 4;");
	await page.getByRole("button", { name: "Save file", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	expect(saves).toBe(2);
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: "../../../../artifacts/forge/workspace-mobile.png", fullPage: true });
});

test("failed project files retry explicitly; a delayed save retains newer typing", async ({ page }) => {
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => route.fulfill({ json: [] }));
	let values = [{ ...workspace, status: "failed" }];
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => {
		expect(route.request().method()).toBe("GET");
		return route.fulfill({ json: values });
	});
	await page.route(`**/api/workspaces/${id}/retry`, (route) => {
		values = [workspace];
		return route.fulfill({ json: workspace });
	});
	await page.route(`**/api/workspaces/${id}/terminal`, (route) => route.fulfill({ json: {} }));
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({ json: { path: "", entries: [], truncated: false } }),
	);
	await page.route(`**/api/workspaces/${id}/diff`, (route) =>
		route.fulfill({
			json: {
				comparison: "merge-base(main, workspace)..workspace",
				baseSha: head,
				head,
				branch: empty,
				staged: empty,
				unstaged: empty,
				untracked: empty,
			},
		}),
	);
	let release: (() => void) | undefined;
	let saving = false;
	await page.route(`**/api/workspaces/${id}/file`, async (route) => {
		const input = route.request().postDataJSON();
		if (route.request().method() === "PUT") {
			saving = true;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
		await route.fulfill({
			json: {
				path: input.path,
				content: input.content,
				version: (route.request().method() === "POST" ? "1" : "2").repeat(64),
			},
		});
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByRole("button", { name: "Retry opening files", exact: true }).click();
	await page.getByLabel("New file path").fill("new.ts");
	await page.getByRole("button", { name: "Create file", exact: true }).click();
	const editor = page.getByRole("textbox", { name: "File editor" });
	await editor.fill("first draft");
	await page.getByRole("button", { name: "Save file", exact: true }).click();
	await expect.poll(() => saving).toBe(true);
	await editor.fill("newer typing");
	release?.();
	await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
	await expect(editor).toContainText("newer typing");
	await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Discard all drafts", exact: true }).click();
	await expect(page.getByRole("button", { name: /workspace/i })).toHaveCount(0);
});
