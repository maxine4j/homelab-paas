import { expect, test, vi } from "vitest";

import { ManagementRefreshService } from "./management-refresh-service.ts";

test.each(["pause", "resume"] as const)("%s refreshes management state after success and failure", async (action) => {
	const run = vi.fn(async () => {});
	const operation = vi.fn(async (_id: string) => {});
	const service = new ManagementRefreshService(
		{ refreshOne: async () => {}, refreshAll: async () => [] },
		{ run },
		undefined,
		undefined,
		{ pause: operation, resume: operation },
	);
	await service[action]("demo");
	expect(operation).toHaveBeenCalledWith("demo");
	expect(run).toHaveBeenCalledOnce();
	operation.mockRejectedValueOnce(new Error("lifecycle failed"));
	await expect(service[action]("demo")).rejects.toThrow("lifecycle failed");
	expect(run).toHaveBeenCalledTimes(2);
});

test("manual refresh audits the selected service and settles resulting repair before observation", async () => {
	const order: string[] = [];
	const service = new ManagementRefreshService(
		{
			refreshOne: async () => {
				order.push("git");
			},
			refreshAll: async () => [],
		},
		{
			run: async () => {
				order.push("state");
			},
		},
		{
			run: async (id) => {
				order.push(`audit:${id}`);
			},
		},
		{
			settle: async () => {
				order.push("settle");
			},
		},
	);
	await service.refreshOne("demo");
	expect(order).toEqual(["git", "audit:demo", "settle", "state"]);
});

test.each(["one", "all"])(
	"%s refresh awaits reconciliation before refreshing UI state, including failures",
	async (kind) => {
		const order: string[] = [];
		const git = {
			refreshOne: vi.fn(async () => {
				order.push("git");
			}),
			refreshAll: vi.fn(async () => {
				order.push("git");
				return [{ serviceId: "demo", refreshed: true }];
			}),
		};
		const refresh = vi.fn(async () => {
			order.push("state");
		});
		const service = new ManagementRefreshService(git, { run: refresh });
		if (kind === "one") {
			await service.refreshOne("demo");
			expect(git.refreshOne).toHaveBeenCalledWith("demo");
			git.refreshOne.mockRejectedValueOnce(new Error("fetch failed"));
			await expect(service.refreshOne("demo")).rejects.toThrow("fetch failed");
		} else {
			expect(await service.refreshAll()).toEqual([{ serviceId: "demo", refreshed: true }]);
			git.refreshAll.mockRejectedValueOnce(new Error("reconcile failed"));
			await expect(service.refreshAll()).rejects.toThrow("reconcile failed");
		}
		expect(order).toEqual(["git", "state", "state"]);
		expect(refresh).toHaveBeenCalledTimes(2);
	},
);
