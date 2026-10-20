import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../config/paas-config.ts";
import type { GitFile } from "../git/types.ts";
import { captureLogs } from "../util/test/logs.ts";
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
	};
	const createService = (services = deps.services, privateIngressEnabled = false) =>
		new ReconcilerService(
			services,
			deps.retry,
			deps.git,
			deps.decode,
			deps.web,
			deps.state,
			deps.now,
			privateIngressEnabled,
		);
	return {
		deps,
		states,
		fetchFile,
		reconcile,
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

test("accepts surge and passes it to the web reconciler", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "surge",
		content: JSON.stringify({
			...descriptor,
			resources: { app: { ...descriptor.resources.app, rolloutStrategy: "surge" } },
		}),
	});
	await f.service.reconcile();
	expect(f.reconcile).toHaveBeenCalledWith(
		expect.objectContaining({ resource: expect.objectContaining({ rolloutStrategy: "surge" }) }),
	);
	expect(f.states.get("demo")).toEqual({ desiredRevision: "surge", activeRevision: "surge", phase: "ready" });
});

test("accepts private ingress when platform authentication and TLS are enabled", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "private",
		content: JSON.stringify({
			...descriptor,
			resources: { app: { ...descriptor.resources.app, ingress: { port: 8080 } } },
		}),
	});
	await f.createService(f.deps.services, true).reconcile();
	expect(f.reconcile).toHaveBeenCalledWith(
		expect.objectContaining({ resource: expect.objectContaining({ ingress: { public: false, port: 8080 } }) }),
	);
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

test.each([
	{ ...descriptor.resources, worker: { type: "worker", image: "worker:1" } },
	{ ...descriptor.resources, db: { type: "postgres", image: "postgres:17" } },
	{ ...descriptor.resources, queue: { type: "rabbitmq", image: "rabbitmq:4" } },
	{},
	{ app: { ...descriptor.resources.app, replicas: 2 } },
	{ app: { ...descriptor.resources.app, ingress: { public: false, port: 8080 } } },
	{ app: { ...descriptor.resources.app, env: [{ name: "TOKEN", secret: true }] } },
	{ app: { ...descriptor.resources.app, volumes: [{ source: "data", target: "/data" }] } },
	{ app: { ...descriptor.resources.app, limits: { cpus: 1 } } },
	{ app: { ...descriptor.resources.app, egress: ["other"] } },
])("rejects unsupported runtime capabilities before changing any workloads: %j", async (resources) => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({ revision: "unsupported", content: JSON.stringify({ ...descriptor, resources }) });
	await f.service.reconcile();
	expect(f.reconcile).not.toHaveBeenCalled();
	expect(f.states.get("demo")).toMatchObject({ desiredRevision: "unsupported", phase: "failed" });
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
});

test("logs changed revisions, retry schedules and recovery without logging unchanged passes", async () => {
	const f = fixture();
	const capture = captureLogs();
	try {
		await f.service.reconcile();
		await f.service.reconcile();
		f.fetchFile.mockRejectedValueOnce(new Error("SECRET"));
		await f.service.reconcile();
		await f.service.reconcile();
		f.advance(1000);
		await f.service.reconcile();
	} finally {
		capture.restore();
	}
	const records = capture.lines.map((line) => JSON.parse(line));
	expect(records.map(({ event }) => event)).toEqual([
		"reconciliation.revision",
		"reconciliation.failed",
		"reconciliation.recovered",
	]);
	expect(records.at(1)).toMatchObject({ serviceId: "demo", failures: 1, retryAt: 1000 });
	expect(capture.lines.join("")).not.toContain("SECRET");
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
