import { expect, test, vi } from "vitest";

import { ResourcePoller } from "./resource-poller.ts";

test("polls serially, coalesces refresh, serializes actions and aborts/unsubscribes on stop", async () => {
	vi.useFakeTimers();
	try {
		let complete: (value: number) => void = () => {};
		let signal: AbortSignal | undefined;
		const read = vi.fn((abort: AbortSignal) => {
			signal = abort;
			return new Promise<number>((resolve) => {
				complete = resolve;
			});
		});
		const values: number[] = [];
		const poller = new ResourcePoller(
			read,
			(value) => values.push(value),
			() => {},
			100,
		);
		poller.refresh();
		poller.refresh();
		await vi.advanceTimersByTimeAsync(500);
		expect(read).toHaveBeenCalledTimes(1);
		const action = vi.fn(async () => 2);
		const mutation = poller.mutate(action);
		expect(action).not.toHaveBeenCalled();
		complete(1);
		await mutation;
		expect(values).toEqual([1, 2]);
		await vi.advanceTimersByTimeAsync(100);
		expect(read).toHaveBeenCalledTimes(2);
		poller.stop();
		expect(signal?.aborted).toBe(true);
		complete(3);
		await vi.advanceTimersByTimeAsync(500);
		expect(values).toEqual([1, 2]);
		expect(read).toHaveBeenCalledTimes(2);
	} finally {
		vi.useRealTimers();
	}
});
