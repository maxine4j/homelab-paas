import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../configuration/configuration.ts";
import type { GitFile } from "../git/types.ts";
import { ReconcilerService } from "./reconciler-service.ts";
import type { ReconciliationState } from "./types.ts";

const descriptor = {
	version: 1,
	metadata: { serviceId: "demo" },
	resources: { app: { type: "web", image: "app:1", ingress: { public: true, port: 8080 } } },
};

function fixture() {
	let time = 0;
	const states = new Map<string, ReconciliationState>();
	const fetchFile = vi.fn(async (): Promise<GitFile> => ({ revision: "rev", content: JSON.stringify(descriptor) }));
	const reconcile = vi.fn(async () => {});
	const report = vi.fn();
	const deps = {
		services: { demo: { remote: "local", descriptorPath: "/repo/demo.sd.yaml" } },
		retry: { retryBackoffSeconds: 1, maxRetryBackoffSeconds: 4 },
		git: { fetchFile },
		decode: decodeDescriptorYaml,
		web: { type: "web" as const, lifecycle: "deployment" as const, reconcile },
		state: {
			async read(id: string) {
				return states.get(id);
			},
			async write(id: string, state: ReconciliationState) {
				states.set(id, state);
			},
		},
		now: () => time,
		report,
	};
	const createService = (services = deps.services) =>
		new ReconcilerService(services, deps.retry, deps.git, deps.decode, deps.web, deps.state, deps.now, deps.report);
	return {
		deps,
		states,
		fetchFile,
		reconcile,
		report,
		createService,
		service: createService(),
		advance(ms: number) {
			time += ms;
		},
	};
}

test("fetches a committed descriptor, validates it and reconciles actual state on every poll", async () => {
	const f = fixture();
	await f.service.reconcile();
	await f.service.reconcile();
	expect(f.fetchFile).toHaveBeenCalledWith("demo", f.deps.services.demo);
	expect(f.reconcile).toHaveBeenCalledTimes(2);
	expect(f.reconcile).toHaveBeenCalledWith({
		serviceId: "demo",
		resourceId: "app",
		revision: "rev",
		resource: expect.objectContaining({ image: "app:1" }),
	});
	expect(f.states.get("demo")).toEqual({ desiredRevision: "rev", activeRevision: "rev", phase: "ready" });
});

test("validates the entire descriptor before invoking a resource reconciler", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "bad",
		content: JSON.stringify({ ...descriptor, resources: { ...descriptor.resources, db: { type: "postgres" } } }),
	});
	await f.service.reconcile();
	expect(f.reconcile).not.toHaveBeenCalled();
	expect(f.states.get("demo")).toMatchObject({ desiredRevision: "bad", phase: "failed" });
});

test("Git failures preserve active state, sanitize errors and do not prevent other services", async () => {
	const f = fixture();
	await f.service.reconcile();
	f.fetchFile.mockRejectedValue(new Error("SECRET"));
	const services = { ...f.deps.services, other: { remote: "repo", descriptorPath: "other.sd.yaml" } };
	await f.createService(services).reconcile();
	expect(f.fetchFile).toHaveBeenCalledTimes(3);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
	expect(f.states.get("demo")).toMatchObject({ activeRevision: "rev", desiredRevision: "rev", phase: "failed" });
	expect(JSON.stringify([...f.states])).not.toContain("SECRET");
	expect(JSON.stringify(f.report.mock.calls)).not.toContain("SECRET");
});

test("persists deploying before mutation and applies bounded exponential retries across restarts", async () => {
	const f = fixture();
	f.reconcile.mockImplementation(async () => {
		expect(f.states.get("demo")?.phase).toBe("deploying");
		throw new Error("SECRET");
	});
	await f.service.reconcile();
	for (const delay of [1000, 2000, 4000, 4000]) {
		expect(f.states.get("demo")?.retryAt).toBe(f.deps.now() + delay);
		const calls = f.fetchFile.mock.calls.length;
		const restarted = f.createService();
		await restarted.reconcile();
		expect(f.fetchFile).toHaveBeenCalledTimes(calls);
		f.advance(delay);
		await restarted.reconcile();
	}
	f.reconcile.mockResolvedValue();
	f.advance(4000);
	await f.service.reconcile();
	expect(f.states.get("demo")).toEqual({ desiredRevision: "rev", activeRevision: "rev", phase: "ready" });
});

test("concurrent entry points serialize Git fetches and deployments", async () => {
	const f = fixture();
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.reconcile.mockImplementationOnce(async () => blocked);
	const first = f.service.reconcile();
	const second = f.service.reconcile();
	await vi.waitFor(() => expect(f.reconcile).toHaveBeenCalledTimes(1));
	expect(f.fetchFile).toHaveBeenCalledTimes(1);
	release();
	await Promise.all([first, second]);
	expect(f.reconcile).toHaveBeenCalledTimes(2);
});
