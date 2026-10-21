import { expect, test, vi } from "vitest";

import { fetchUi, pollUi } from "./api.ts";

test("fetches private snapshots with cancellation and preserves auth errors", async () => {
	const request = vi.fn(async () => new Response(JSON.stringify({ clusterId: "local" })));
	const controller = new AbortController();
	expect(await fetchUi("/cluster", controller.signal, request)).toEqual({ clusterId: "local" });
	expect(request).toHaveBeenCalledWith(
		"/api/ui/cluster",
		expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }),
	);
	await expect(
		fetchUi("/cluster", controller.signal, async () => new Response("secret-canary", { status: 401 })),
	).rejects.toThrow("A platform session is required");
	await expect(
		fetchUi("/cluster", controller.signal, async () => new Response("secret-canary", { status: 503 })),
	).rejects.toThrow("Cluster data is unavailable");
});
test("polling refreshes without overlap, reports errors and cancels on navigation", async () => {
	vi.useFakeTimers();
	try {
		const updates: unknown[] = [];
		let finish: (response: Response) => void = () => {};
		const request = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		const cancel = pollUi("/services", (result) => updates.push(result), request);
		await vi.advanceTimersByTimeAsync(5000);
		expect(request).toHaveBeenCalledTimes(1);
		finish(new Response("[]"));
		await vi.advanceTimersByTimeAsync(0);
		expect(updates).toEqual([{ data: [] }]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(request).toHaveBeenCalledTimes(2);
		finish(new Response("private", { status: 503 }));
		await vi.advanceTimersByTimeAsync(0);
		expect(updates.at(-1)).toMatchObject({ error: expect.stringContaining("Cluster data is unavailable") });
		cancel();
		await vi.advanceTimersByTimeAsync(20000);
		expect(request).toHaveBeenCalledTimes(2);
	} finally {
		vi.useRealTimers();
	}
});
test("navigation suppresses late responses from cancelled requests", async () => {
	let finish: (response: Response) => void = () => {};
	const updates = vi.fn();
	const cancel = pollUi(
		"/cluster",
		updates,
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	cancel();
	finish(new Response("{}"));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(updates).not.toHaveBeenCalled();
});
