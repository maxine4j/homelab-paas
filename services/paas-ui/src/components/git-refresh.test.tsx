import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { GitRefreshFeedback, runGitRefresh } from "./git-refresh.tsx";

test("refresh feedback distinguishes scope, progress and safe failures", () => {
	const idle = renderToStaticMarkup(<GitRefreshFeedback onRefresh={() => {}} />);
	expect(idle).toContain("Refresh all services from Git");
	const pending = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' pending message='Fetching Git and reconciling…' onRefresh={() => {}} />,
	);
	expect(pending).toContain("disabled");
	expect(pending).toContain('role="status"');
	expect(pending).toContain("Fetching Git and reconciling");
	const failed = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' error='Cannot refresh Git' onRefresh={() => {}} />,
	);
	expect(failed).toContain("Refresh service from Git");
	expect(failed).toContain('role="alert">Cannot refresh Git');
});

test("refresh action reports pending, partial and success feedback and reloads snapshots", async () => {
	const update = vi.fn();
	const reload = vi.fn();
	await runGitRefresh(undefined, new AbortController().signal, update, reload, async () =>
		Response.json({
			results: [
				{ serviceId: "demo", refreshed: true },
				{ serviceId: "broken", refreshed: false },
			],
		}),
	);
	expect(update.mock.calls.at(0)?.at(0)).toMatchObject({ pending: true });
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({ pending: false, error: expect.stringContaining("broken") });
	expect(reload).toHaveBeenCalledTimes(1);
	await runGitRefresh(undefined, new AbortController().signal, update, reload, async () =>
		Response.json({ results: [{ serviceId: "broken", refreshed: false }] }),
	);
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({
		pending: false,
		error: expect.stringContaining("0 of 1 repositories refreshed"),
	});
	await runGitRefresh("demo", new AbortController().signal, update, reload, async () =>
		Response.json({ results: [{ serviceId: "demo", refreshed: true }] }),
	);
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({
		pending: false,
		message: expect.stringContaining("Git refresh complete"),
	});
	await runGitRefresh(
		"demo",
		new AbortController().signal,
		update,
		reload,
		async () => new Response("secret-canary", { status: 503 }),
	);
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({
		pending: false,
		error: expect.stringContaining("Cannot refresh Git"),
	});
	expect(JSON.stringify(update.mock.calls)).not.toContain("secret-canary");
});

test("navigation cancels waiting and suppresses late feedback and reloads", async () => {
	const controller = new AbortController();
	const update = vi.fn();
	const reload = vi.fn();
	let finish: (response: Response) => void = () => {};
	const pending = runGitRefresh(
		"demo",
		controller.signal,
		update,
		reload,
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	controller.abort();
	finish(Response.json({ results: [{ serviceId: "demo", refreshed: true }] }));
	await pending;
	expect(update).toHaveBeenCalledTimes(1);
	expect(reload).not.toHaveBeenCalled();
});
