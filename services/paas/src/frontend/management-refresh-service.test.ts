import { expect, test, vi } from "vitest";

import { ManagementRefreshService } from "./management-refresh-service.ts";

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
