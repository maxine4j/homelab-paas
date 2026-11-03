import type { AgentView } from "@homelab-paas/forge-contracts/agents";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const createdAt = "2026-11-03T00:00:00.000Z";
const setup = async (page: Page) => {
	const views: AgentView[] = [];
	const writes: string[] = [];
	const replies: unknown[] = [];
	let fail = false;
	let reads = 0;
	await page.addInitScript(() => {
		class ControlledEvents {
			onmessage: (() => void) | null = null;
			onopen: (() => void) | null = null;
			onerror: (() => void) | null = null;
			constructor() {
				window.addEventListener("agent-event", this.notify);
				queueMicrotask(() => this.onopen?.());
			}
			notify = (event: Event) => {
				const type = (event as CustomEvent<string>).detail;
				if (type === "error") this.onerror?.();
				else if (type === "open") this.onopen?.();
				else this.onmessage?.();
			};
			close() {
				window.removeEventListener("agent-event", this.notify);
			}
		}
		Object.defineProperty(window, "EventSource", { value: ControlledEvents });
	});
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const path = new URL(route.request().url()).pathname;
			const method = route.request().method();
			if (method !== "GET") writes.push(path);
			if (path === "/api/projects")
				return route.fulfill({ json: [{ id: projectId, name: "Forge", status: "ready", createdAt }] });
			if (path === "/api/accounts")
				return route.fulfill({
					json: {
						codex: { connection: "available", login: { state: "idle" } },
						github: { connection: "available", login: { state: "idle" } },
					},
				});
			if (path.endsWith("/agents")) {
				if (method === "POST") {
					const id = `123e4567-e89b-42d3-a456-${String(426614174001 + views.length)}`;
					const view: AgentView = {
						thread: {
							id,
							projectId,
							workspaceId: id,
							title: route.request().postDataJSON().title,
							createdAt,
							status: "idle",
						},
						items: [],
						requests: [],
						truncated: false,
					};
					views.push(view);
					return route.fulfill({ status: 201, json: view });
				}
				return route.fulfill({ json: views.map((view) => view.thread) });
			}
			if (path.startsWith("/api/agents/")) {
				const view = views.find((value) => value.thread.id === path.split("/")[3])!;
				if (method === "GET") {
					reads++;
					return route.fulfill({ json: view });
				}
				if (fail) return route.fulfill({ status: 503, json: { error: "agent-unavailable" } });
				if (path.endsWith("/messages")) {
					view.items.push({
						id: `user-${writes.length}`,
						role: "user",
						text: route.request().postDataJSON().text,
					});
					view.thread.status = "running";
					view.thread.turnId = "turn-1";
				}
				if (path.endsWith("/interrupt")) view.thread.status = "interrupted";
				if (path.endsWith("/resume")) {
					view.thread.status = "completed";
					view.items = [{ id: "history", role: "assistant", text: "Recovered history" }];
				}
				if (path.endsWith("/replies")) {
					replies.push(route.request().postDataJSON());
					view.requests = [];
					view.thread.status = "running";
				}
				return route.fulfill({ json: view });
			}
			if (path.endsWith("/branches")) return route.fulfill({ json: [{ name: "main", sha: "a".repeat(40) }] });
			if (path.endsWith("/tree"))
				return route.fulfill({ json: { path: "", head: "a".repeat(40), entries: [], truncated: false } });
			return route.fulfill({ status: 404, json: {} });
		},
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Open Forge", exact: true }).click();
	await page.getByRole("tab", { name: "Agents", exact: true }).click();
	const create = async (title: string) => {
		await page.getByLabel("Chat title", { exact: true }).fill(title);
		await page.getByRole("button", { name: "Create chat", exact: true }).click();
		await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
	};
	const event = async (type = "changed") =>
		page.evaluate((detail) => window.dispatchEvent(new CustomEvent("agent-event", { detail })), type);
	return {
		views,
		writes,
		replies,
		create,
		event,
		reads: () => reads,
		fail: (value: boolean) => {
			fail = value;
		},
	};
};

test("independent chats retain drafts and running activity across tabs and reopening", async ({ page }) => {
	const fixture = await setup(page);
	await fixture.create("First chat");
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("Inspect this project");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(page.getByText("Inspect this project", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Interrupt", exact: true })).toBeEnabled();
	await fixture.create("Second chat");
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("Second draft");
	await page.getByRole("button", { name: "Open chat First chat", exact: true }).click();
	fixture.views[0]!.items.push(
		{ id: "answer", role: "assistant", text: "I found the entry point." },
		{ id: "tool", role: "activity", text: "git status\nClean" },
	);
	await fixture.event();
	await expect(page.getByText("I found the entry point.", { exact: true })).toBeVisible();
	await page.screenshot({ path: "../../../../artifacts/forge-browser/agents-desktop.png" });
	await page.getByRole("button", { name: "Interrupt", exact: true }).click();
	await expect(page.getByText("interrupted", { exact: true }).last()).toBeVisible();
	await page.getByRole("tab", { name: "Code", exact: true }).click();
	await page.getByRole("tab", { name: "Agents", exact: true }).click();
	await page.getByRole("button", { name: "Open chat Second chat", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Second draft");
	await page.reload();
	await page.getByRole("button", { name: "Open Forge", exact: true }).click();
	await page.getByRole("tab", { name: "Agents", exact: true }).click();
	await page.getByRole("button", { name: "Open chat First chat", exact: true }).click();
	await expect(page.getByText("I found the entry point.", { exact: true })).toBeVisible();
});

test("failed sends keep drafts; reconnect only reads; uncertain execution requires explicit recovery", async ({
	page,
}) => {
	const fixture = await setup(page);
	await fixture.create("Recovery");
	fixture.fail(true);
	await page.getByLabel("Message", { exact: true }).fill("Keep this draft");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Chat unavailable");
	await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep this draft");
	const writes = fixture.writes.length;
	await fixture.event("error");
	await expect(page.getByText("Reconnecting to live updates…", { exact: true })).toBeVisible();
	fixture.views[0]!.thread.status = "uncertain";
	const reads = fixture.reads();
	await fixture.event("open");
	await expect.poll(fixture.reads).toBeGreaterThan(reads);
	await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
	expect(fixture.writes).toHaveLength(writes);
	fixture.fail(false);
	await page.getByRole("button", { name: "Resume and load history", exact: true }).click();
	await expect(page.getByText("Recovered history", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep this draft");
	await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("one-time command and file approvals, clarification and truncation are visible", async ({ page }) => {
	const fixture = await setup(page);
	await fixture.create("Approvals");
	const view = fixture.views[0]!;
	view.thread.status = "waiting";
	view.truncated = true;
	view.requests = [{ id: "approval-1", kind: "command", description: "Run pnpm test", questions: [] }];
	await fixture.event();
	await expect(page.getByText("Some history or output was omitted.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Allow once", exact: true }).click();
	await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
	view.requests = [{ id: "approval-2", kind: "file", description: "Edit README.md", questions: [] }];
	view.thread.status = "waiting";
	await fixture.event();
	await page.getByRole("button", { name: "Decline", exact: true }).click();
	view.requests = [
		{
			id: "input",
			kind: "input",
			description: "Choose scope",
			questions: [{ id: "scope", question: "Which scope?", secret: false, options: ["Small", "Large"] }],
		},
	];
	view.thread.status = "waiting";
	await fixture.event();
	await page.getByRole("button", { name: "Small", exact: true }).click();
	fixture.fail(true);
	await page.getByRole("button", { name: "Submit answers", exact: true }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.getByLabel("Which scope?", { exact: true })).toHaveValue("Small");
	fixture.fail(false);
	await page.getByRole("button", { name: "Submit answers", exact: true }).click();
	await expect(page.getByRole("button", { name: "Submit answers", exact: true })).toHaveCount(0);
	expect(fixture.writes.filter((path) => path.endsWith("/replies"))).toHaveLength(4);
	expect(fixture.replies).toEqual([
		{ requestId: "approval-1", decision: "accept" },
		{ requestId: "approval-2", decision: "decline" },
		{ requestId: "input", answers: { scope: "Small" } },
	]);
});

test("mobile chat keeps composer and long tool output within the viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const fixture = await setup(page);
	await fixture.create("Mobile chat");
	fixture.views[0]!.items = [
		{ id: "long", role: "activity", text: "command-output-".repeat(80) },
		{ id: "reply", role: "assistant", text: "Ready for your next message." },
	];
	await fixture.event();
	await expect(page.getByText("Ready for your next message.", { exact: true })).toBeVisible();
	await page.getByLabel("Message", { exact: true }).fill("A mobile draft");
	await page.screenshot({ path: "../../../../artifacts/forge-browser/agents-mobile.png", fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
