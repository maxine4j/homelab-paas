import { expect, test, vi } from "vitest";

import type { ServiceContainer } from "../docker/types.ts";
import { ServicePauseService } from "./service-pause-service.ts";

const fixture = () => {
	const order: string[] = [];
	const withdraw = vi.fn(async (_id: string) => {
		order.push("withdraw");
	});
	const listServiceContainers = vi.fn(async (_id: string): Promise<ServiceContainer[]> => [
		{ id: "web", resourceId: "web", state: "running", imageId: "i", revision: "r", spec: "s" },
		{ id: "worker", resourceId: "jobs", state: "paused", imageId: "i", revision: "r", spec: "s" },
		{ id: "stopped", resourceId: "db", state: "exited", imageId: "i", revision: "r", spec: "s" },
	]);
	const stopServiceContainer = vi.fn(async (_id: string, container: string, _timeout: number) => {
		order.push(container);
	});
	const service = new ServicePauseService({ listServiceContainers, stopServiceContainer }, { withdraw });
	return { service, withdraw, listServiceContainers, stopServiceContainer, order };
};

test("withdraws all ingress before stopping service containers, without deleting them", async () => {
	const f = fixture();
	await f.service.enforce("demo");
	expect(f.order).toEqual(["withdraw", "web", "worker"]);
	expect(f.stopServiceContainer.mock.calls).toEqual([
		["demo", "web", 30],
		["demo", "worker", 30],
	]);
});

test("attempts every container stop even if route publication or another stop fails", async () => {
	const f = fixture();
	f.withdraw.mockRejectedValueOnce(new Error("Envoy unavailable"));
	f.stopServiceContainer.mockRejectedValueOnce(new Error("Docker unavailable"));
	await expect(f.service.enforce("demo")).rejects.toThrow("Cannot fully pause service");
	expect(f.stopServiceContainer).toHaveBeenCalledTimes(2);
});
