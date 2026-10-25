import type { UiServiceEvent } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import { decodeDescriptorYaml } from "../config/paas-config.ts";
import type { GitFile } from "../git/types.ts";
import { testConfig } from "../util/test/config.ts";
import { captureLogs } from "../util/test/logs.ts";
import { EnvironmentResolver } from "./environment-resolver.ts";
import { ReconcilerService } from "./reconciler-service.ts";
import type { ReconciliationState } from "./types.ts";
import { serviceEventMessages } from "./types.ts";

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
	const reconcileWorker = vi.fn(async () => {});
	const readSecrets = vi.fn(async (): Promise<string | undefined> => undefined);
	const appendEvent = vi.fn(async (_serviceId: string, _event: UiServiceEvent) => {});
	const resolveHostPath = vi.fn(async (): Promise<string | undefined> => undefined);
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
			testConfig({
				services: services,
				reconciliation: deps.retry,
				auth: privateIngressEnabled ? testConfig().getAuthConfig() : undefined,
			}),
			deps.git,
			deps.decode,
			deps.web,
			deps.state,
			deps.now,
			new EnvironmentResolver("/etc/homelab-paas/env", readSecrets, { resolve: resolveHostPath }),
			{ type: "worker", lifecycle: "deployment", reconcile: reconcileWorker },
			{ append: appendEvent, list: async () => [] },
		);
	return {
		deps,
		states,
		fetchFile,
		reconcile,
		reconcileWorker,
		readSecrets,
		appendEvent,
		resolveHostPath,
		createService,
		service: createService(),
		advance(ms: number) {
			time += ms;
		},
	};
}

test("includes missing secret names and the actual host file in persisted failure events", async () => {
	const f = fixture();
	f.resolveHostPath.mockResolvedValue("/srv/config/env/demo.env");
	f.readSecrets.mockResolvedValue("PRESENT=private-value\n");
	f.fetchFile.mockResolvedValue({
		revision: "rev",
		content: JSON.stringify({
			...descriptor,
			resources: {
				app: {
					...descriptor.resources.app,
					env: [
						{ name: "PRESENT", secret: true },
						{ name: "TOKEN", secret: true },
						{ name: "PASSWORD", secret: true },
					],
				},
			},
		}),
	});
	await f.service.reconcile();
	expect(f.appendEvent).toHaveBeenCalledWith(
		"demo",
		expect.objectContaining({
			resourceId: "app",
			secretFailure: {
				reason: "missing-variables",
				filePath: "/etc/homelab-paas/env/demo.env",
				hostFilePath: "/srv/config/env/demo.env",
				missingVariables: ["TOKEN", "PASSWORD"],
			},
		}),
	);
	expect(JSON.stringify(f.appendEvent.mock.calls)).not.toContain("private-value");
	expect(f.reconcile).not.toHaveBeenCalled();
});

test.each(["fetch", "descriptor", "capabilities", "secrets", "web", "worker"] as const)(
	"records safe %s failures with retry metadata, then recovery without unchanged-poll noise",
	async (stage) => {
		const f = fixture();
		if (stage === "fetch") f.fetchFile.mockRejectedValueOnce(new Error("raw-secret"));
		if (stage === "descriptor") f.fetchFile.mockResolvedValueOnce({ revision: "rev", content: "invalid" });
		if (stage === "capabilities")
			f.fetchFile.mockResolvedValueOnce({
				revision: "rev",
				content: JSON.stringify({
					...descriptor,
					resources: { db: { type: "postgres", image: "postgres:17" } },
				}),
			});
		if (stage === "secrets")
			f.fetchFile.mockResolvedValueOnce({
				revision: "rev",
				content: JSON.stringify({
					...descriptor,
					resources: { app: { ...descriptor.resources.app, env: [{ name: "TOKEN", secret: true }] } },
				}),
			});
		if (stage === "web") f.reconcile.mockRejectedValueOnce(new Error("raw-secret"));
		if (stage === "worker") {
			f.fetchFile.mockResolvedValueOnce({
				revision: "rev",
				content: JSON.stringify({
					...descriptor,
					resources: { app: { type: "worker", image: "app:1", healthcheckPort: 8080 } },
				}),
			});
			f.reconcileWorker.mockRejectedValueOnce(new Error("raw-secret"));
		}
		await f.service.reconcile();
		expect(f.appendEvent).toHaveBeenCalledWith(
			"demo",
			expect.objectContaining({
				timestamp: 0,
				level: "error",
				event: "reconciliation.failed",
				failures: 1,
				retryAt: 1000,
			}),
		);
		const [, failure] = f.appendEvent.mock.calls.at(0) ?? [];
		expect(failure?.message).toBe(serviceEventMessages[stage]);
		expect(JSON.stringify(failure)).not.toContain("raw-secret");
		if (["secrets", "web", "worker"].includes(stage)) expect(failure).toMatchObject({ resourceId: "app" });
		await f.service.reconcile();
		expect(f.appendEvent).toHaveBeenCalledTimes(1);
		f.advance(1000);
		await f.service.reconcile();
		expect(f.appendEvent).toHaveBeenLastCalledWith(
			"demo",
			expect.objectContaining({ event: "reconciliation.recovered", level: "info", timestamp: 1000 }),
		);
		const calls = f.appendEvent.mock.calls.length;
		await f.service.reconcile();
		expect(f.appendEvent).toHaveBeenCalledTimes(calls);
	},
);

test("records state failures even when checkpoint storage is unavailable", async () => {
	const f = fixture();
	f.deps.state.read = vi.fn(async () => {
		throw new Error("raw-secret");
	});
	await f.service.reconcile();
	expect(f.appendEvent).toHaveBeenCalledWith(
		"demo",
		expect.objectContaining({
			event: "reconciliation.state-failed",
			level: "error",
			message: "Cannot persist reconciliation state; check platform state directory access",
		}),
	);
	expect(JSON.stringify(f.appendEvent.mock.calls)).not.toContain("raw-secret");
});

test("retains deployment diagnostics and events when writing the failed checkpoint also fails", async () => {
	const f = fixture();
	f.reconcile.mockRejectedValue(new Error("original-deployment-error"));
	const write = f.deps.state.write;
	f.deps.state.write = async (id, state) => {
		if (state.phase === "failed") throw new Error("checkpoint-error");
		await write(id, state);
	};
	const capture = captureLogs();
	try {
		await f.service.reconcile();
	} finally {
		capture.restore();
	}
	expect(f.appendEvent.mock.calls.map(([, event]) => event.event)).toEqual([
		"reconciliation.failed",
		"reconciliation.state-failed",
	]);
	expect(capture.lines.map((line) => JSON.parse(line))).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "reconciliation.failed",
				err: expect.objectContaining({ message: "original-deployment-error" }),
			}),
			expect.objectContaining({
				event: "reconciliation.state-failed",
				err: expect.objectContaining({ message: "checkpoint-error" }),
			}),
		]),
	);
});

test("event persistence failure is logged and does not prevent deployment or other services", async () => {
	const f = fixture();
	f.appendEvent.mockRejectedValue(new Error("event storage unavailable"));
	const logs = captureLogs();
	try {
		await f.service.reconcile();
	} finally {
		logs.restore();
	}
	expect(f.states.get("demo")?.phase).toBe("ready");
	expect(logs.lines.map((line) => JSON.parse(line))).toEqual(
		expect.arrayContaining([expect.objectContaining({ event: "service-events.append-failed" })]),
	);
});

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

test("normalizes single-web implicit primary and passes independent multiple web resources", async () => {
	const f = fixture();
	await f.service.reconcile();
	expect(f.reconcile).toHaveBeenLastCalledWith(
		expect.objectContaining({ resource: expect.objectContaining({ primary: true }) }),
	);
	f.fetchFile.mockResolvedValue({
		revision: "multi",
		content: JSON.stringify({
			...descriptor,
			resources: {
				app: { ...descriptor.resources.app, primary: false },
				admin: { ...descriptor.resources.app, primary: true },
			},
		}),
	});
	await f.service.reconcile();
	expect(f.reconcile).toHaveBeenLastCalledWith(
		expect.objectContaining({ resourceId: "admin", resource: expect.objectContaining({ primary: true }) }),
	);
	expect(f.reconcile.mock.calls).toHaveLength(3);
});

test("resolves secrets again on unchanged Git polls and passes mounts and limits", async () => {
	const f = fixture();
	const volumes = [{ hostPath: "/mnt/media", mountPath: "/data", readOnly: true }];
	const limits = { cpus: 0.5, memoryMiB: 256 };
	f.fetchFile.mockResolvedValue({
		revision: "rev",
		content: JSON.stringify({
			...descriptor,
			resources: {
				app: {
					...descriptor.resources.app,
					volumes,
					limits,
					env: [
						{ name: "TOKEN", secret: true },
						{ name: "PLAIN", value: "literal" },
					],
				},
			},
		}),
	});
	f.readSecrets.mockResolvedValue("TOKEN=first-secret\nUNUSED=ignored");
	await f.service.reconcile();
	f.readSecrets.mockResolvedValue("TOKEN=second-secret");
	await f.service.reconcile();
	expect(f.readSecrets).toHaveBeenCalledTimes(2);
	expect(f.reconcile.mock.calls).toEqual([
		[
			expect.objectContaining({
				resource: expect.objectContaining({
					volumes,
					limits,
					env: [
						{ name: "TOKEN", value: "first-secret" },
						{ name: "PLAIN", value: "literal" },
					],
				}),
			}),
		],
		[
			expect.objectContaining({
				resource: expect.objectContaining({
					volumes,
					limits,
					env: [
						{ name: "TOKEN", value: "second-secret" },
						{ name: "PLAIN", value: "literal" },
					],
				}),
			}),
		],
	]);
	expect(f.states.get("demo")).toEqual({ desiredRevision: "rev", activeRevision: "rev", phase: "ready" });
});

test.each([
	undefined,
	"OTHER=secret-value-canary",
	"TOKEN='secret-value-canary",
	"TOKEN=secret-value-canary\nTOKEN=another",
])("secret failure preserves active deployment before invoking rollout: %j", async (content) => {
	const f = fixture();
	await f.service.reconcile();
	f.reconcile.mockClear();
	f.fetchFile.mockResolvedValue({
		revision: "changed",
		content: JSON.stringify({
			...descriptor,
			resources: { app: { ...descriptor.resources.app, env: [{ name: "TOKEN", secret: true }] } },
		}),
	});
	f.readSecrets.mockResolvedValue(content);
	const capture = captureLogs();
	try {
		await f.service.reconcile();
	} finally {
		capture.restore();
	}
	expect(f.reconcile).not.toHaveBeenCalled();
	expect(f.states.get("demo")).toMatchObject({
		desiredRevision: "changed",
		activeRevision: "rev",
		phase: "failed",
		error: "Cannot resolve application secrets; check the service env file and required variable names",
	});
	expect(JSON.stringify([...f.states])).not.toContain("TOKEN");
	expect(capture.lines.join("")).not.toContain("secret-value-canary");
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
	{ worker: { type: "worker", image: "worker:1", healthcheckPort: 9090, egress: ["other"] } },
	{ ...descriptor.resources, db: { type: "postgres", image: "postgres:17" } },
	{ ...descriptor.resources, queue: { type: "rabbitmq", image: "rabbitmq:4" } },
	{},
	{ app: { ...descriptor.resources.app, replicas: 2 } },
	{ app: { ...descriptor.resources.app, ingress: { public: false, port: 8080 } } },
	{ app: { ...descriptor.resources.app, egress: ["other"] } },
])("rejects unsupported runtime capabilities before changing any workloads: %j", async (resources) => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({ revision: "unsupported", content: JSON.stringify({ ...descriptor, resources }) });
	await f.service.reconcile();
	expect(f.reconcile).not.toHaveBeenCalled();
	expect(f.states.get("demo")).toMatchObject({ desiredRevision: "unsupported", phase: "failed" });
});

test.each([false, true])("reconciles worker replicas with optional web resource: web=%j", async (withWeb) => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "workers",
		content: JSON.stringify({
			...descriptor,
			resources: {
				...(withWeb ? descriptor.resources : {}),
				jobs: {
					type: "worker",
					image: "jobs:1",
					healthcheckPort: 9090,
					replicas: 3,
					env: [{ name: "TOKEN", secret: true }],
				},
				other: { type: "worker", image: "other:1", healthcheckPort: 9091 },
			},
		}),
	});
	f.readSecrets.mockResolvedValue("TOKEN=worker-secret");
	await f.service.reconcile();
	expect(f.reconcile).toHaveBeenCalledTimes(withWeb ? 1 : 0);
	expect(f.reconcileWorker).toHaveBeenCalledTimes(2);
	expect(f.reconcileWorker).toHaveBeenCalledWith(
		expect.objectContaining({
			resourceId: "jobs",
			resource: expect.objectContaining({ replicas: 3, env: [{ name: "TOKEN", value: "worker-secret" }] }),
		}),
	);
	expect(f.states.get("demo")).toEqual({ desiredRevision: "workers", activeRevision: "workers", phase: "ready" });
});

test("resolves every worker secret before changing a web resource", async () => {
	const f = fixture();
	f.fetchFile.mockResolvedValue({
		revision: "workers",
		content: JSON.stringify({
			...descriptor,
			resources: {
				...descriptor.resources,
				jobs: {
					type: "worker",
					image: "jobs:1",
					healthcheckPort: 9090,
					env: [{ name: "TOKEN", secret: true }],
				},
			},
		}),
	});
	await f.service.reconcile();
	expect(f.reconcile).not.toHaveBeenCalled();
	expect(f.reconcileWorker).not.toHaveBeenCalled();
	expect(f.states.get("demo")).toMatchObject({ phase: "failed", error: expect.stringContaining("secrets") });
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
	expect(records.at(1).err).toMatchObject({ message: "SECRET", stack: expect.stringContaining("SECRET") });
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
