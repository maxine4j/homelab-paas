import { expect, test } from "@playwright/test";

test("PR reviews bind to the displayed committed diff, detect races and retain discussion when unavailable", async ({
	page,
}) => {
	const projectId = "123e4567-e89b-42d3-a456-426614174000";
	const id = "123e4567-e89b-42d3-a456-426614174001";
	const prId = "123e4567-e89b-42d3-a456-426614174002";
	const revision = { baseSha: "a".repeat(40), head: "b".repeat(40), mergeBase: "a".repeat(40) };
	const createdAt = "2026-11-02T00:00:00.000Z";
	const workspace = {
		id,
		projectId,
		name: "Manual",
		branch: `forge/workspace/${id}`,
		head: revision.head,
		baseSha: revision.baseSha,
		status: "ready",
		createdAt,
	};
	const summary = {
		id: prId,
		projectId,
		workspaceId: id,
		branch: workspace.branch,
		base: "main",
		title: "Review code",
		body: "Context",
		status: "open",
		createdAt,
	};
	let status = "open";
	let mismatch = true;
	let unavailable = false;
	let approval = "stale";
	let discussion: unknown[] = [];
	const detail = () => ({
		...summary,
		status,
		...(unavailable ? {} : { revision: mismatch ? { ...revision, head: "c".repeat(40) } : revision }),
		approval: unavailable ? "unavailable" : approval,
		discussion,
	});
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => route.fulfill({ json: [workspace] }));
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({ json: { path: "", entries: [], truncated: false } }),
	);
	await page.route(`**/api/workspaces/${id}/diff`, (route) => {
		const empty = { files: [], patch: "", truncated: false };
		return route.fulfill({
			json: {
				comparison: "merge-base(main, workspace)..workspace",
				baseSha: revision.baseSha,
				head: revision.head,
				branch: empty,
				staged: empty,
				unstaged: empty,
				untracked: empty,
			},
		});
	});
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => route.fulfill({ json: [summary] }));
	await page.route(`**/api/pull-requests/${prId}`, (route) => {
		if (route.request().method() === "PATCH") {
			const input = route.request().postDataJSON();
			expect(input.expectedHead).toBe(revision.head);
			expect(input.expectedBase).toBe(revision.baseSha);
			status = input.status ?? status;
			if (input.title) summary.title = input.title;
		}
		return route.fulfill({ json: detail() });
	});
	await page.route(`**/api/pull-requests/${prId}/diff`, (route) =>
		unavailable
			? route.fulfill({ status: 503, json: { error: "pull-request-unavailable" } })
			: route.fulfill({
					json: {
						comparison: "merge-base(main, workspace)..workspace (committed)",
						revision,
						diff: {
							files: [{ path: "file.ts", binary: false }],
							patch: "+reviewed code",
							truncated: false,
						},
					},
				}),
	);
	await page.route(`**/api/pull-requests/${prId}/reviews`, (route) => {
		const input = route.request().postDataJSON();
		expect(input.expectedHead).toBe(revision.head);
		expect(input.expectedBase).toBe(revision.baseSha);
		approval = input.decision === "approve" ? "approved" : "requested-changes";
		discussion = [
			{
				id: "123e4567-e89b-42d3-a456-426614174003",
				pullRequestId: prId,
				kind: input.decision,
				body: input.body,
				revision,
				createdAt,
			},
		];
		return route.fulfill({ json: detail() });
	});
	await page.route(`**/api/pull-requests/${prId}/comments`, (route) => {
		const input = route.request().postDataJSON();
		expect(input.expectedHead).toBe(revision.head);
		discussion = [
			{
				id: "123e4567-e89b-42d3-a456-426614174003",
				pullRequestId: prId,
				kind: "comment",
				body: input.body,
				revision,
				createdAt,
			},
		];
		return route.fulfill({ json: detail() });
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByText("Pull requests", { exact: true }).first().click();
	await expect(page.getByRole("button", { name: "Review code", exact: true })).toBeVisible({ timeout: 1000 });
	await page.getByRole("button", { name: "Review code", exact: true }).click();
	await expect(page.getByText("Revision changed while loading. Refresh review.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
	mismatch = false;
	await page.getByRole("button", { name: "Refresh review" }).click();
	await expect(page.getByText("+reviewed code", { exact: true })).toBeVisible();
	await page.getByLabel("Review or comment").fill("Looks good");
	await page.getByRole("button", { name: "Approve", exact: true }).click();
	await expect(page.getByText("Approval: approved", { exact: true })).toBeVisible();
	await page.getByLabel("PR title", { exact: true }).fill("Revised title");
	await page.getByRole("button", { name: "Save PR metadata" }).click();
	await expect(page.getByRole("heading", { name: "Revised title", exact: true })).toBeVisible();
	await page.getByLabel("Review or comment").fill("Please revise");
	await page.getByRole("button", { name: "Request changes", exact: true }).click();
	await expect(page.getByText("Approval: requested-changes", { exact: true })).toBeVisible();
	await page.getByLabel("Review or comment").fill("Looks good");
	await page.getByRole("button", { name: "Add comment", exact: true }).click();
	await page.getByRole("button", { name: "Close PR", exact: true }).click();
	await page.getByRole("button", { name: "Reopen PR", exact: true }).click();
	unavailable = true;
	await page.getByRole("button", { name: "Refresh review" }).click();
	await expect(page.getByText("Approval: unavailable", { exact: true })).toBeVisible();
	await expect(page.getByText("Looks good", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
	await expect(page.getByText("+reviewed code", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /merge/i })).toHaveCount(0);
});

test("create PR explicitly previews the revision and sends both expected refs", async ({ page }) => {
	const projectId = "123e4567-e89b-42d3-a456-426614174000";
	const id = "123e4567-e89b-42d3-a456-426614174001";
	const createdAt = "2026-11-02T00:00:00.000Z";
	const revision = { baseSha: "a".repeat(40), head: "b".repeat(40), mergeBase: "a".repeat(40) };
	const workspace = {
		id,
		projectId,
		name: "Manual",
		branch: `forge/workspace/${id}`,
		head: revision.head,
		baseSha: revision.baseSha,
		status: "ready",
		createdAt,
	};
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => route.fulfill({ json: [workspace] }));
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({ json: { path: "", entries: [], truncated: false } }),
	);
	const empty = { files: [], patch: "", truncated: false };
	await page.route(`**/api/workspaces/${id}/diff`, (route) =>
		route.fulfill({
			json: {
				comparison: "merge-base(main, workspace)..workspace",
				baseSha: revision.baseSha,
				head: revision.head,
				branch: empty,
				staged: empty,
				unstaged: empty,
				untracked: empty,
			},
		}),
	);
	await page.route(`**/api/workspaces/${id}/pull-request-revision`, (route) =>
		route.fulfill({ json: { revision, hasChanges: true } }),
	);
	let created = false;
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => {
		if (route.request().method() !== "POST") return route.fulfill({ json: [] });
		expect(route.request().postDataJSON()).toEqual({
			workspaceId: id,
			title: "New PR",
			body: "Description",
			expectedHead: revision.head,
			expectedBase: revision.baseSha,
		});
		created = true;
		return route.fulfill({
			json: {
				id: "123e4567-e89b-42d3-a456-426614174002",
				projectId,
				workspaceId: id,
				branch: workspace.branch,
				base: "main",
				title: "New PR",
				body: "Description",
				status: "open",
				createdAt,
				revision,
				approval: "none",
				discussion: [],
			},
		});
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByText("Pull requests", { exact: true }).first().click();
	await expect(page.getByRole("button", { name: "Preview PR revision" })).toBeVisible({ timeout: 1000 });
	await page.getByLabel("New PR title").fill("New PR");
	await page.getByLabel("New PR description").fill("Description");
	await expect(page.getByRole("button", { name: "Create PR", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Preview PR revision" }).click();
	await page.getByRole("button", { name: "Create PR", exact: true }).click();
	await expect.poll(() => created).toBe(true);
});
