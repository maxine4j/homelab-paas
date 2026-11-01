import { expect, test, vi } from "vitest";

import { PaasConfig } from "../config/paas-config.ts";
import { ChangeBus } from "../events/change-bus.ts";
import { testConfig, testConfigValue } from "../util/test/config.ts";
import { OrphanCleanup } from "./orphan-cleanup.ts";

const fixture = () => {
	const config = testConfig({ services: { demo: { remote: "repo", descriptorPath: "sd.yaml" } } });
	const changes = new ChangeBus();
	const docker = {
		listClusterWorkloads: vi.fn(async () => [
			{ id: "active", serviceId: "demo" },
			{ id: "old", serviceId: "deleted" },
			{ id: "stopped", serviceId: "deleted" },
		]),
		stopServiceContainer: vi.fn(async (_serviceId: string, _id: string, _timeout: number) => {}),
		removeServiceContainer: vi.fn(async (_serviceId: string, _id: string) => {}),
	};
	const scheduler = { settle: vi.fn(async () => {}) };
	const cleanup = new OrphanCleanup(config, docker, scheduler, changes, () => "cleanup-test");
	return { config, changes, docker, scheduler, cleanup };
};

test("waits for in-flight deployments before discovering and gracefully removing only deleted-service containers", async () => {
	const f = fixture();
	let release!: () => void;
	f.scheduler.settle.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const work = f.cleanup.run();
	await vi.waitFor(() => expect(f.scheduler.settle).toHaveBeenCalled());
	expect(f.docker.listClusterWorkloads).not.toHaveBeenCalled();
	release();
	await work;
	expect(f.docker.stopServiceContainer.mock.calls).toEqual([
		["deleted", "old", 30],
		["deleted", "stopped", 30],
	]);
	expect(f.docker.removeServiceContainer.mock.calls).toEqual([
		["deleted", "old"],
		["deleted", "stopped"],
	]);
});

test("cleanup failures do not prevent other retirements and are retried by the next scan", async () => {
	const f = fixture();
	f.docker.stopServiceContainer.mockRejectedValueOnce(new Error("unavailable"));
	await expect(f.cleanup.run()).rejects.toThrow("Orphan cleanup failed");
	expect(f.docker.removeServiceContainer.mock.calls).toEqual([["deleted", "stopped"]]);
	await f.cleanup.run();
	expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("deleted", "old");
});

test("rechecks accepted configuration before stopping and removing a re-added service", async () => {
	const f = fixture();
	f.docker.stopServiceContainer.mockImplementationOnce(async () => {
		f.config.getServices()["deleted"] = { remote: "repo", descriptorPath: "sd.yaml" };
	});
	await f.cleanup.run();
	expect(f.docker.stopServiceContainer).toHaveBeenCalledTimes(1);
	expect(f.docker.removeServiceContainer).not.toHaveBeenCalled();
});

test("accepted global desired-input changes trigger cleanup only when services disappear; shutdown unsubscribes", async () => {
	const f = fixture();
	f.cleanup.initialize();
	f.changes.publish({ desiredInputs: true });
	f.changes.publish({ serviceId: "demo", desiredInputs: true });
	expect(f.scheduler.settle).not.toHaveBeenCalled();
	delete f.config.getServices()["demo"];
	f.changes.publish({});
	expect(f.scheduler.settle).not.toHaveBeenCalled();
	f.changes.publish({ desiredInputs: true });
	await vi.waitFor(() => expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "active"));
	await f.cleanup.stop();
	f.docker.listClusterWorkloads.mockClear();
	await f.cleanup.run();
	f.changes.publish({ desiredInputs: true });
	expect(f.docker.listClusterWorkloads).not.toHaveBeenCalled();
});

test("overlapping scans serialize and retain a fresh scan after an in-flight inventory", async () => {
	const f = fixture();
	let release!: () => void;
	f.docker.listClusterWorkloads.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () => resolve([]);
			}),
	);
	const first = f.cleanup.run();
	await vi.waitFor(() => expect(f.docker.listClusterWorkloads).toHaveBeenCalledTimes(1));
	const second = f.cleanup.run();
	release();
	await Promise.all([first, second]);
	expect(f.docker.listClusterWorkloads).toHaveBeenCalledTimes(2);
});

test("retains a cleanup request arriving as the final inventory completes", async () => {
	const f = fixture();
	let again: Promise<void> | undefined;
	f.docker.listClusterWorkloads.mockImplementationOnce(async () => {
		queueMicrotask(() =>
			queueMicrotask(() => {
				again = f.cleanup.run();
			}),
		);
		return [];
	});
	await f.cleanup.run();
	await again;
	expect(f.docker.listClusterWorkloads).toHaveBeenCalledTimes(2);
});

test.each(["UI save", "file reload"])(
	"%s removes workloads only after accepted durable config publication",
	async (mode) => {
		const f = fixture();
		const initial = testConfigValue({ services: f.config.getServices() });
		let value: unknown = initial;
		let revision = "initial";
		const config = new PaasConfig(
			{
				read: async () => ({ value, revision }),
				write: async (next) => {
					value = next;
					revision = "saved";
					return { value, revision };
				},
			},
			{},
			f.changes,
		);
		await config.load();
		const cleanup = new OrphanCleanup(config, f.docker, f.scheduler, f.changes, () => "config-cleanup-test");
		cleanup.initialize();
		if (mode === "UI save") {
			await expect(
				config.updateConfig({ revision: "stale", changes: [{ path: "services", value: {} }] }),
			).rejects.toThrow();
			expect(f.docker.listClusterWorkloads).not.toHaveBeenCalled();
			await config.updateConfig({ revision, changes: [{ path: "services", value: {} }] });
		} else {
			value = {};
			revision = "invalid";
			await config.reload();
			expect(f.docker.listClusterWorkloads).not.toHaveBeenCalled();
			value = { ...initial, services: {} };
			revision = "external";
			await config.reload();
		}
		await vi.waitFor(() => expect(f.docker.removeServiceContainer).toHaveBeenCalledWith("demo", "active"));
		await cleanup.stop();
	},
);
