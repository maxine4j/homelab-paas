import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { GitRefreshFeedback, runGitRefresh, runRedeploy, runServiceLifecycle } from "./git-refresh.tsx";

test("service actions show Pause or Resume and block redeploy while paused", () => {
	const render = (paused: boolean, pending = false) =>
		renderToStaticMarkup(
			<GitRefreshFeedback
				serviceId='demo'
				paused={paused}
				pending={pending}
				onRefresh={() => {}}
				onRedeploy={() => {}}
				onLifecycle={() => {}}
			/>,
		);
	expect(render(false)).toContain("Pause</button>");
	expect(render(true)).toContain("Resume</button>");
	expect(render(true).match(/disabled/g)).toHaveLength(1);
	expect(render(false, true).match(/disabled/g)).toHaveLength(3);
});

test.each(["pause", "resume"] as const)(
	"%s feedback refreshes snapshots after success or uncertain failure",
	async (action) => {
		const update = vi.fn();
		const reload = vi.fn();
		const controller = new AbortController();
		await runServiceLifecycle(
			"demo",
			action,
			controller.signal,
			update,
			reload,
			async () => new Response(null, { status: 204 }),
		);
		expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({
			pending: false,
			message: action === "pause" ? "Service paused." : "Service resumed.",
		});
		await runServiceLifecycle(
			"demo",
			action,
			controller.signal,
			update,
			reload,
			async () => new Response(null, { status: 503 }),
		);
		expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({ error: expect.stringContaining(`Cannot ${action}`) });
		expect(reload).toHaveBeenCalledTimes(2);
		update.mockClear();
		await runServiceLifecycle("demo", action, controller.signal, update, reload, async () => {
			controller.abort();
			return new Response(null, { status: 204 });
		});
		expect(update).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledTimes(2);
	},
);

test("service actions include warning redeploy and info refresh, disabled together", () => {
	const html = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' pending onRefresh={() => {}} onRedeploy={() => {}} />,
	);
	expect(html).toContain('class="action-info"');
	expect(html).toContain('class="action-warning"');
	expect(html).toContain("Redeploy</button>");
	expect(html).toContain("Refresh</button>");
	expect(html.match(/disabled/g)).toHaveLength(2);
	expect(html.match(/action-spinner/g)).toHaveLength(2);
	expect(renderToStaticMarkup(<GitRefreshFeedback onRefresh={() => {}} />)).not.toContain("Redeploy");
});

test("redeploy feedback reloads on success, reports failures and suppresses cancelled completion", async () => {
	const update = vi.fn();
	const reload = vi.fn();
	await runRedeploy(
		"demo",
		new AbortController().signal,
		update,
		reload,
		async () => new Response(null, { status: 204 }),
	);
	expect(update.mock.calls.at(0)?.at(0)).toMatchObject({ pending: true });
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({ pending: false, message: "Redeploy complete." });
	expect(reload).toHaveBeenCalledTimes(1);
	await runRedeploy(
		"demo",
		new AbortController().signal,
		update,
		reload,
		async () => new Response(null, { status: 503 }),
	);
	expect(update.mock.calls.at(-1)?.at(0)).toMatchObject({ error: expect.stringContaining("Cannot redeploy") });
	const controller = new AbortController();
	update.mockClear();
	await runRedeploy("demo", controller.signal, update, reload, async () => {
		controller.abort();
		return new Response(null, { status: 204 });
	});
	expect(update).toHaveBeenCalledTimes(1);
	expect(reload).toHaveBeenCalledTimes(1);
});

test("refresh feedback distinguishes scope, progress and safe failures", () => {
	const idle = renderToStaticMarkup(<GitRefreshFeedback onRefresh={() => {}} />);
	expect(idle).toContain("Refresh all</button>");
	const pending = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' pending message='Fetching Git and reconciling…' onRefresh={() => {}} />,
	);
	expect(pending).toContain("disabled");
	expect(pending).toContain('class="action-pending" role="status"');
	expect(pending).toContain("Fetching Git and reconciling");
	const failed = renderToStaticMarkup(
		<GitRefreshFeedback serviceId='demo' error='Cannot refresh Git' onRefresh={() => {}} />,
	);
	expect(failed).toContain("Refresh</button>");
	expect(failed).toContain('class="action-toast action-toast-error"');
	expect(failed).toContain('role="alert"');
	expect(failed).toContain("Cannot refresh Git");
	expect(failed).toContain('aria-label="Dismiss notification"');
	const complete = renderToStaticMarkup(<GitRefreshFeedback message='Refresh complete' onRefresh={() => {}} />);
	expect(complete).toContain('class="action-toast"');
	expect(complete).toContain('role="status"');
	expect(pending).not.toContain('class="action-toast');
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
