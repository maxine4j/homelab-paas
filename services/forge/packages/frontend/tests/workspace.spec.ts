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

test("failed workspace switch clears old actionable tree and diff", async ({ page }) => {
	const other = {
		...workspace,
		id: "123e4567-e89b-42d3-a456-426614174003",
		name: "Other",
		branch: "forge/workspace/123e4567-e89b-42d3-a456-426614174003",
	};
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const path = new URL(route.request().url()).pathname;
			if (path === "/api/projects")
				return route.fulfill({
					json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }],
				});
			if (path.endsWith("/workspaces")) return route.fulfill({ json: [workspace, other] });
			if (path.endsWith("/pull-requests")) return route.fulfill({ json: [] });
			if (path.endsWith("/terminal")) return route.fulfill({ json: {} });
			if (path.includes(other.id))
				return route.fulfill({ status: 503, json: { error: "workspace-unavailable" } });
			if (path.endsWith("/tree"))
				return route.fulfill({
					json: { path: "", entries: [{ name: "old.ts", path: "old.ts", kind: "file" }], truncated: false },
				});
			if (path.endsWith("/diff"))
				return route.fulfill({
					json: {
						comparison: "merge-base(main, workspace)..workspace",
						baseSha: head,
						head,
						branch: empty,
						staged: empty,
						unstaged: empty,
						untracked: { ...empty, files: [{ path: "old.ts", binary: false }] },
					},
				});
			return route.fulfill({ status: 503, json: {} });
		},
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByRole("button", { name: "Open Manual" }).click();
	await expect(page.getByRole("button", { name: "Stage old.ts", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Open Other" }).click();
	await expect(page.getByRole("region", { name: "Project workspace" }).getByRole("alert").first()).toContainText(
		"workspace-unavailable",
	);
	await expect(page.getByRole("button", { name: "old.ts", exact: true })).toHaveCount(0, { timeout: 1000 });
	await expect(page.getByRole("button", { name: "Stage old.ts", exact: true })).toHaveCount(0);
});

test("workspace changes show four comparisons and commit uses the displayed head", async ({ page }) => {
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
	await page.getByRole("button", { name: "Open Manual" }).click();
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

test("an old pending stage cannot publish its diff into a newly selected workspace", async ({ page }) => {
	const other = {
		...workspace,
		id: "123e4567-e89b-42d3-a456-426614174003",
		name: "Other",
		branch: "forge/workspace/123e4567-e89b-42d3-a456-426614174003",
	};
	let release: (() => void) | undefined;
	let staging = false;
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path === "/api/projects")
				return route.fulfill({
					json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }],
				});
			if (path.endsWith("/workspaces")) return route.fulfill({ json: [workspace, other] });
			if (path.endsWith("/pull-requests")) return route.fulfill({ json: [] });
			if (path.endsWith("/terminal")) return route.fulfill({ json: {} });
			if (path.endsWith("/tree")) return route.fulfill({ json: { path: "", entries: [], truncated: false } });
			if (path.endsWith("/stage")) {
				staging = true;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return route.fulfill({ json: workspace });
			}
			if (path.endsWith("/diff"))
				return route.fulfill({
					json: {
						comparison: "merge-base(main, workspace)..workspace",
						baseSha: head,
						head,
						branch: empty,
						staged: empty,
						unstaged: empty,
						untracked: {
							...empty,
							files: [{ path: path.includes(other.id) ? "new.ts" : "old.ts", binary: false }],
						},
					},
				});
			return route.fulfill({ status: 503, json: {} });
		},
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByRole("button", { name: "Open Manual" }).click();
	await page.getByRole("button", { name: "Stage old.ts", exact: true }).click();
	await expect.poll(() => staging).toBe(true);
	await page.getByRole("button", { name: "Open Other" }).click();
	await expect(page.getByRole("button", { name: "Stage new.ts", exact: true })).toBeVisible();
	const completed = page.waitForResponse(`**/api/workspaces/${id}/diff`);
	release?.();
	await (await completed).finished();
	await page.evaluate(() => new Promise(requestAnimationFrame));
	await expect(page.getByRole("button", { name: "Stage old.ts", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Stage new.ts", exact: true })).toBeVisible();
});

test("open workspace, edit tabs, retain unsaved content through conflict and navigation, explicitly recover", async ({
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
	await page.getByRole("button", { name: "Open Manual" }).click();
	await page.getByRole("button", { name: "file.ts", exact: true }).click();
	const editor = page.getByRole("textbox", { name: "File editor" });
	await editor.fill("const local = 3;");
	await page.getByRole("button", { name: "Save file", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("file-conflict");
	await expect(editor).toContainText("const local = 3;");
	await page.getByRole("button", { name: "Back to projects" }).click();
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

test("workspace create/retry/archive and file creation preserve data; a delayed save retains newer typing", async ({
	page,
}) => {
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt: workspace.createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => route.fulfill({ json: [] }));
	let values = [{ ...workspace, status: "failed" }];
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => {
		if (route.request().method() === "POST") {
			expect(route.request().postDataJSON()).toEqual({ name: "Created" });
			values = [{ ...workspace, name: "Created" }];
			return route.fulfill({ json: values[0] });
		}
		return route.fulfill({ json: values });
	});
	await page.route(`**/api/workspaces/${id}/retry`, (route) => {
		values = [workspace];
		return route.fulfill({ json: workspace });
	});
	await page.route(`**/api/workspaces/${id}`, (route) => {
		expect(route.request().method()).toBe("DELETE");
		values = [{ ...workspace, name: "Created", status: "archived" }];
		return route.fulfill({ json: values[0] });
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
	await page.getByRole("button", { name: "Retry Manual", exact: true }).click();
	await expect(page.getByRole("button", { name: "Open Manual" })).toContainText("ready");
	await page.getByLabel("Workspace name", { exact: true }).fill("Created");
	await page.getByRole("button", { name: "Create workspace", exact: true }).click();
	await page.getByRole("button", { name: "Open Created" }).click();
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
	await page.getByRole("button", { name: "Archive workspace (preserve files)", exact: true }).click();
	await expect(page.getByRole("button", { name: "Open Created" })).toContainText("archived");
	await expect(page.getByRole("button", { name: "Create file", exact: true })).toHaveCount(0);
});
