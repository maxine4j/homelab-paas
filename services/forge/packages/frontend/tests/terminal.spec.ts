import { expect, test } from "@playwright/test";

test("terminal explicitly creates, fits, reattaches same session, shows gaps/loss and closes", async ({ page }) => {
	const projectId = "123e4567-e89b-42d3-a456-426614174000";
	const id = "123e4567-e89b-42d3-a456-426614174001";
	const terminalId = "123e4567-e89b-42d3-a456-426614174002";
	const head = "a".repeat(40);
	const createdAt = "2026-11-02T00:00:00.000Z";
	const workspace = {
		id,
		projectId,
		name: "Manual",
		branch: `forge/workspace/${id}`,
		head,
		baseSha: head,
		status: "ready",
		createdAt,
	};
	let session: object | undefined;
	let status = "running";
	const current = () => ({ id: terminalId, workspaceId: id, status, cols: 80, rows: 24, createdAt });
	let creates = 0;
	let attaches = 0;
	const inputs: unknown[] = [];
	await page.route("**/api/accounts", (route) => route.fulfill({ status: 503, json: {} }));
	await page.route("**/api/projects", (route) =>
		route.fulfill({ json: [{ id: projectId, name: "Project", status: "ready", createdAt }] }),
	);
	await page.route(`**/api/projects/${projectId}/workspaces`, (route) => route.fulfill({ json: [workspace] }));
	await page.route(`**/api/projects/${projectId}/pull-requests`, (route) => route.fulfill({ json: [] }));
	await page.route(`**/api/workspaces/${id}/tree?*`, (route) =>
		route.fulfill({ json: { path: "", entries: [], truncated: false } }),
	);
	const empty = { files: [], patch: "", truncated: false };
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
	await page.route(`**/api/workspaces/${id}/terminal`, (route) => {
		if (route.request().method() === "POST") {
			creates++;
			session = current();
			return route.fulfill({ status: 201, json: session });
		}
		return route.fulfill({ json: session ? { session } : {} });
	});
	await page.route(`**/api/terminals/${terminalId}`, (route) => {
		status = "closed";
		return route.fulfill({ json: current() });
	});
	await page.routeWebSocket(`**/api/terminals/${terminalId}/socket?after=*`, (socket) => {
		attaches++;
		if (attaches === 1) expect(socket.url()).toContain("after=0");
		else expect(socket.url()).toContain(attaches === 2 ? "after=1" : "after=10");
		socket.onMessage((message) => inputs.push(JSON.parse(String(message))));
		socket.send(JSON.stringify({ type: "output", sequence: 1, data: "real terminal bytes\r\n" }));
		socket.send(JSON.stringify({ type: "status", session: current() }));
		if (attaches === 1) setTimeout(() => socket.close(), 250);
		else if (attaches === 2) {
			socket.send(JSON.stringify({ type: "gap", through: 10 }));
			socket.send(JSON.stringify({ type: "status", session: { ...current(), status: "lost" } }));
			socket.send(
				JSON.stringify({ type: "status", session: { ...current(), workspaceId: projectId, status: "closed" } }),
			);
		}
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Open Project" }).click();
	await page.getByRole("button", { name: "Open Manual" }).click();
	await expect(page.getByRole("button", { name: "Create shell", exact: true })).toBeVisible({ timeout: 1000 });
	expect(creates).toBe(0);
	expect(attaches).toBe(0);
	await page.getByRole("button", { name: "Create shell", exact: true }).click();
	await expect(page.locator(".xterm")).toBeVisible();
	await expect
		.poll(() =>
			inputs.some(
				(input) => typeof input === "object" && input !== null && "type" in input && input.type === "resize",
			),
		)
		.toBe(true);
	await page.locator(".xterm-helper-textarea").fill("echo hello\n");
	await expect
		.poll(() =>
			inputs.some(
				(input) => typeof input === "object" && input !== null && "type" in input && input.type === "input",
			),
		)
		.toBe(true);
	await expect(page.getByText("Disconnected. Reconnect to the same shell.")).toBeVisible();
	expect(creates).toBe(1);
	await page.getByRole("button", { name: "Reconnect", exact: true }).click();
	await expect(page.getByText("Output gap through 10. Some terminal output is unavailable.")).toBeVisible();
	await expect(page.getByText("Shell: lost", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Reconnect", exact: true }).click();
	await expect.poll(() => attaches).toBe(3);
	await expect(page.getByText("Output gap through 10. Some terminal output is unavailable.")).toBeVisible();
	expect(creates).toBe(1);
	await page.screenshot({ path: "../../../../artifacts/forge/terminal-lost.png", fullPage: true });
	await page.getByRole("button", { name: "Close shell", exact: true }).click();
	await expect(page.getByText("Shell: closed", { exact: true })).toBeVisible();
});
