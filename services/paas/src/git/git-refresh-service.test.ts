import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { GitRefreshService } from "./git-refresh-service.ts";

const source = { remote: "https://example.com/repo", descriptorPath: "file.yaml" };
const fixture = () => {
	const refreshFile = vi.fn(async (_serviceId: string) => ({ revision: "revision", content: "descriptor" }));
	const reconcile = vi.fn(async () => {});
	return {
		refreshFile,
		reconcile,
		service: new GitRefreshService(
			testConfig({ services: { a: source, b: source } }),
			{ refreshFile },
			{ reconcile },
		),
	};
};

test("all refreshes run concurrently and isolate failures before reconciling cached data", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.refreshFile.mockImplementation(async (serviceId) => {
		if (serviceId === "a") {
			await blocked;
			throw new Error("private remote failure");
		}
		return { revision: "revision", content: "descriptor" };
	});
	const running = f.service.refreshAll();
	await Promise.resolve();
	expect(f.refreshFile.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
	expect(f.reconcile).not.toHaveBeenCalled();
	release();
	expect(await running).toEqual([
		{ serviceId: "a", refreshed: false },
		{ serviceId: "b", refreshed: true },
	]);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
});
test("one refresh validates membership and reconciles only after a successful fetch", async () => {
	const f = fixture();
	await expect(f.service.refreshOne("missing")).rejects.toMatchObject({ kind: "not-found" });
	await expect(f.service.refreshOne("toString")).rejects.toMatchObject({ kind: "not-found" });
	expect(f.refreshFile).not.toHaveBeenCalled();
	await f.service.refreshOne("b");
	expect(f.refreshFile).toHaveBeenCalledWith("b", source);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
	f.refreshFile.mockRejectedValue(new Error("private error"));
	await expect(f.service.refreshOne("b")).rejects.toMatchObject({ kind: "unavailable" });
	expect(f.reconcile).toHaveBeenCalledTimes(1);
});
