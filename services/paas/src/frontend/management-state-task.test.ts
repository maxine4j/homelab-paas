import { expect, test, vi } from "vitest";

import { ManagementStateTask } from "./management-state-task.ts";

test("health polling completes before the cache is refreshed; manual and periodic passes serialize", async () => {
	const order: string[] = [];
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const run = vi.fn(async () => {
		order.push("health");
		await blocked;
	});
	const refresh = vi.fn(async () => {
		order.push("cache");
	});
	const task = new ManagementStateTask({ run, refresh: run }, { refresh });
	const first = task.run();
	const second = task.run();
	await Promise.resolve();
	expect(run).toHaveBeenCalledTimes(1);
	expect(refresh).not.toHaveBeenCalled();
	release();
	await Promise.all([first, second]);
	expect(order).toEqual(["health", "cache", "health", "cache"]);
});

test("health failure still refreshes snapshots and does not prevent the next pass", async () => {
	const run = vi.fn(async () => {});
	run.mockRejectedValueOnce(new Error("health failed"));
	const refresh = vi.fn(async () => {});
	const task = new ManagementStateTask({ run, refresh: run }, { refresh });
	await expect(task.run()).rejects.toThrow("health failed");
	expect(refresh).toHaveBeenCalledTimes(1);
	await task.run();
	expect(refresh).toHaveBeenCalledTimes(2);
});

test("targeted lifecycle observations refresh only the affected health and cached snapshots", async () => {
	const refreshHealth = vi.fn(async (_serviceId: string) => {});
	const refresh = vi.fn(async (_serviceId?: string) => {});
	const run = vi.fn(async () => {});
	const task = new ManagementStateTask({ run, refresh: refreshHealth }, { refresh });
	await task.refresh("demo");
	expect(refreshHealth).toHaveBeenCalledWith("demo");
	expect(refresh).toHaveBeenCalledWith("demo");
	expect(run).not.toHaveBeenCalled();
});
