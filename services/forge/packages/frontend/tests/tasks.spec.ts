import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const createdAt = "2026-11-03T00:00:00.000Z";
const setup = async (page: Page) => {
	let tickets = [
		{ id: "FORGE-1", projectId, title: "First task", description: "Scope", status: "draft", createdAt },
		{ id: "FORGE-2", projectId, title: "Second task", description: "", status: "draft", createdAt },
	];
	let failMove = false;
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const path = new URL(route.request().url()).pathname;
			const method = route.request().method();
			if (path === "/api/projects")
				return route.fulfill({ json: [{ id: projectId, name: "Forge", status: "ready", createdAt }] });
			if (path === "/api/accounts")
				return route.fulfill({
					json: {
						codex: { connection: "available", login: { state: "idle" } },
						github: { connection: "available", login: { state: "idle" } },
					},
				});
			if (path.endsWith("/tickets")) {
				if (method === "POST") {
					const ticket = {
						...route.request().postDataJSON(),
						id: `FORGE-${tickets.length + 1}`,
						projectId,
						status: "draft",
						createdAt,
					};
					tickets.push(ticket);
					return route.fulfill({ status: 201, json: ticket });
				}
				return route.fulfill({ json: tickets });
			}
			if (path.startsWith("/api/tickets/")) {
				const ticket = tickets.find((value) => value.id === path.split("/")[3])!;
				if (path.endsWith("/move")) {
					if (failMove) return route.fulfill({ status: 503, json: { error: "ticket-unavailable" } });
					const { status, beforeId } = route.request().postDataJSON();
					ticket.status = status;
					tickets = tickets.filter((value) => value.id !== ticket.id);
					const index = tickets.findIndex((value) => value.id === beforeId);
					tickets.splice(index < 0 ? tickets.length : index, 0, ticket);
				} else if (method === "PATCH") Object.assign(ticket, route.request().postDataJSON());
				return route.fulfill({ json: ticket });
			}
			if (path.endsWith("/branches")) return route.fulfill({ json: [{ name: "main", sha: "a".repeat(40) }] });
			if (path.endsWith("/tree"))
				return route.fulfill({ json: { path: "", head: "a".repeat(40), entries: [], truncated: false } });
			return route.fulfill({ status: 404, json: {} });
		},
	);
	await page.goto("/");
	await page.getByRole("link", { name: "Open Forge", exact: true }).click();
	await page.getByRole("tab", { name: "Tasks", exact: true }).click();
	return {
		failMoves: () => {
			failMove = true;
		},
	};
};

test("create and edit tickets; status menu moves a ticket to Done and survives reopening", async ({ page }) => {
	await setup(page);
	const boardUrl = page.url();
	const historyLength = await page.evaluate(() => history.length);
	await page.getByRole("button", { name: "Create ticket", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(page).toHaveURL(boardUrl);
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	await dialog.getByLabel("Title", { exact: true }).fill("New task");
	await dialog.getByLabel("Description", { exact: true }).fill("Simple scope");
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	await expect(page.getByRole("button", { name: "FORGE-3 New task", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "FORGE-3 New task", exact: true }).click();
	await dialog.getByLabel("Title", { exact: true }).fill("Updated task");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "FORGE-3 Updated task", exact: true }).click();
	await dialog.getByLabel("Status", { exact: true }).selectOption("done");
	await expect(dialog.getByLabel("Status", { exact: true })).toHaveValue("done");
	await dialog.getByRole("button", { name: "Close ticket", exact: true }).click();
	await expect(page.getByRole("region", { name: "Done", exact: true }).getByText("Updated task")).toBeAttached();
	await page.reload();
	await expect(page).toHaveURL(`/projects/${projectId}/tasks`);
	await expect(page.getByRole("region", { name: "Done", exact: true }).getByText("Updated task")).toBeAttached();
});

test("desktop drop zones reorder cards and move to an empty column; failures preserve the board", async ({ page }) => {
	const fixture = await setup(page);
	await expect(page.getByRole("button", { name: "FORGE-1 First task", exact: true })).toBeVisible();
	await page.screenshot({ path: "../../../../artifacts/forge-browser/tasks-desktop.png" });
	const handle = page.getByRole("button", { name: "Drag FORGE-2", exact: true });
	const first = page.getByRole("button", { name: "FORGE-1 First task", exact: true });
	await handle.hover();
	await page.mouse.down();
	const rect = (await first.boundingBox())!;
	await page.mouse.move(rect.x + 80, rect.y + 4, { steps: 8 });
	await expect(page.locator(".ticket-drop-placeholder")).toBeVisible();
	await page.mouse.up();
	await expect(
		page.getByRole("region", { name: "Draft", exact: true }).locator(".ticket-card").first(),
	).toContainText("FORGE-2");
	const ready = page.getByRole("region", { name: "Ready", exact: true });
	await handle.hover();
	await page.mouse.down();
	const target = (await ready.boundingBox())!;
	await page.mouse.move(target.x + 100, target.y + 120, { steps: 8 });
	await page.mouse.up();
	await expect(ready.getByText("Second task")).toBeVisible();
	fixture.failMoves();
	await page.getByRole("button", { name: "FORGE-2 Second task", exact: true }).click();
	await page.getByLabel("Status", { exact: true }).selectOption("done");
	await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
	await expect(page.getByLabel("Status", { exact: true })).toHaveValue("ready");
});

test("drag edge scrolling and cancellation preserve ticket state", async ({ page }) => {
	await setup(page);
	const handle = page.getByRole("button", { name: "Drag FORGE-1", exact: true });
	await handle.hover();
	await page.mouse.down();
	const bounds = (await page.locator(".kanban-columns").boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + 120);
	await expect
		.poll(() => page.locator(".kanban-columns").evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(100);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator(".ticket-drag-preview")).toHaveCount(0);
	await expect(page.locator(".ticket-drop-placeholder")).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Draft", exact: true }).getByText("First task")).toBeAttached();
	await handle.scrollIntoViewIfNeeded();
	await handle.hover();
	await page.mouse.down();
	await page.mouse.move(5, 5);
	await page.mouse.up();
	await expect(page.getByRole("region", { name: "Draft", exact: true }).getByText("First task")).toBeAttached();
});

test("mobile touch drag and status dropdown work without widening the page", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	await setup(page);
	const handle = (await page.getByRole("button", { name: "Drag FORGE-1", exact: true }).boundingBox())!;
	const ready = (await page.getByRole("region", { name: "Ready", exact: true }).boundingBox())!;
	const client = await context.newCDPSession(page);
	const x = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	await client.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [{ x: Math.min(ready.x + 40, 370), y: ready.y + 130 }],
	});
	await expect(page.locator(".ticket-drop-placeholder")).toBeVisible();
	await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(page.getByRole("region", { name: "Ready", exact: true }).getByText("First task")).toBeAttached();
	await page.getByRole("button", { name: "FORGE-1 First task", exact: true }).click();
	await page.getByLabel("Status", { exact: true }).selectOption("done");
	await expect(page.getByLabel("Status", { exact: true })).toHaveValue("done");
	await page.screenshot({ path: "../../../../artifacts/forge-browser/tasks-mobile.png" });
	await page.getByRole("button", { name: "Close ticket", exact: true }).click();
	await page.screenshot({ path: "../../../../artifacts/forge-browser/tasks-mobile-board.png" });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await context.close();
});
