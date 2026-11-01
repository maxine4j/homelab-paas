import { expect, test, vi } from "vitest";

import { PaasConfig, decodeDescriptorYaml } from "../config/paas-config.ts";
import { SecretStore } from "../config/secret-store.ts";
import { ServiceSecrets } from "../config/service-secrets.ts";
import { ChangeBus } from "../events/change-bus.ts";
import type { ISleep } from "../util/sleep.ts";
import { testConfigValue } from "../util/test/config.ts";
import { DesiredInputs } from "./desired-inputs.ts";
import { EnvironmentResolver } from "./environment-resolver.ts";
import { EventDiagnostics } from "./event-diagnostics.ts";
import { ResourceRoutingPolicy } from "./networking/resource-routing-policy.ts";
import { ReconcilerService } from "./reconciler-service.ts";
import { ReconciliationScheduler } from "./reconciliation-scheduler.ts";
import type { WebReconciliationRequest } from "./resources/web/web-reconciler.ts";
import type { ReconciliationState } from "./types.ts";

const fixture = async () => {
	let now = 0;
	let secretText = "TOKEN=initial\n";
	let document = {
		value: testConfigValue({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } }),
		revision: "one",
	};
	const configWrite = vi.fn(async (value: unknown) => {
		document = { value: value as typeof document.value, revision: `${document.revision}+` };
		return document;
	});
	const changes = new ChangeBus();
	const config = new PaasConfig({ read: async () => document, write: configWrite }, {}, changes);
	await config.load();
	const fetchFile = vi.fn(async () => ({
		revision: "rev",
		content: JSON.stringify({
			version: 1,
			metadata: { serviceId: "demo" },
			resources: {
				app: {
					type: "web",
					image: "app:1",
					ingress: { public: true, port: 80 },
					env: [{ name: "TOKEN", secret: true }],
				},
			},
		}),
	}));
	const readSecrets = vi.fn(async () => secretText);
	const secretWrite = vi.fn(async (_path: string, content: string | Uint8Array) => {
		secretText = String(content);
	});
	const inputs = new DesiredInputs(
		new ResourceRoutingPolicy(),
		config,
		{ fetchFile },
		decodeDescriptorYaml,
		new EnvironmentResolver("/env", readSecrets),
	);
	const states = new Map<string, ReconciliationState>();
	const state = {
		read: async (id: string) => states.get(id),
		write: async (id: string, value: ReconciliationState) => {
			states.set(id, value);
		},
	};
	const web = vi.fn(async (_request: WebReconciliationRequest) => {});
	const reconciler = new ReconcilerService(
		config,
		inputs,
		{ type: "web", lifecycle: "deployment", reconcile: web },
		state,
		() => now,
		{ type: "worker", lifecycle: "deployment", reconcile: async () => {} },
		{ append: async () => {}, list: async () => [] },
		new EventDiagnostics(config),
		changes,
	);
	const waits: { delay: number; finish: () => void }[] = [];
	const sleep: ISleep = (delay, signal) =>
		new Promise<void>((resolve) => {
			waits.push({ delay, finish: resolve });
			signal?.addEventListener("abort", () => resolve(), { once: true });
		});
	const scheduler = new ReconciliationScheduler(
		config,
		reconciler,
		state,
		inputs,
		sleep,
		() => now,
		() => "run",
		changes,
	);
	scheduler.initialize();
	const secrets = new ServiceSecrets(
		config,
		{ fetchFile },
		decodeDescriptorYaml,
		new SecretStore("/env", readSecrets, secretWrite),
		changes,
	);
	return {
		config,
		configWrite,
		changes,
		fetchFile,
		inputs,
		states,
		web,
		scheduler,
		secrets,
		secretWrite,
		waits,
		readSecrets,
		advance(value: number) {
			now += value;
		},
		setSecret(value: string) {
			secretText = value;
		},
		createScheduler() {
			return new ReconciliationScheduler(
				config,
				reconciler,
				state,
				inputs,
				sleep,
				() => now,
				() => "restart",
				changes,
			);
		},
	};
};

test("accepted secret/config writes target work promptly and rejected or undurable writes do not", async () => {
	const f = await fixture();
	try {
		await f.scheduler.start();
		f.scheduler.invalidate("demo");
		await f.scheduler.settle();
		const initial = await f.secrets.read("demo");
		await f.secrets.update("demo", { revision: initial.revision, changes: [{ name: "TOKEN", value: "updated" }] });
		await f.scheduler.settle();
		expect(f.web).toHaveBeenCalledTimes(2);
		expect(f.web.mock.calls.at(-1)?.[0].resource.env).toEqual([{ name: "TOKEN", value: "updated" }]);
		const current = f.config.getEditableConfig();
		f.configWrite.mockRejectedValueOnce(new Error("disk unavailable"));
		await expect(
			f.config.updateConfig({
				revision: current.revision,
				changes: [{ path: "auth.github.clientSecret", value: "rotated" }],
			}),
		).rejects.toMatchObject({ kind: "unavailable" });
		await f.scheduler.settle();
		expect(f.web).toHaveBeenCalledTimes(2);
		await f.config.updateConfig({
			revision: current.revision,
			changes: [{ path: "auth.github.clientSecret", value: "rotated" }],
		});
		await f.scheduler.settle();
		expect(f.web).toHaveBeenCalledTimes(3);
		await expect(
			f.secrets.update("demo", { revision: initial.revision, changes: [{ name: "TOKEN", value: "stale" }] }),
		).rejects.toMatchObject({ kind: "conflict" });
		await f.scheduler.settle();
		expect(f.web).toHaveBeenCalledTimes(3);
		f.setSecret("");
		await f.scheduler.refreshInputs("demo");
		await f.scheduler.settle();
		expect(f.web).toHaveBeenCalledTimes(3);
		expect(f.states.get("demo")).toMatchObject({ phase: "failed", activeRevision: "rev", failures: 1 });
		expect(JSON.stringify([...f.states])).not.toContain("updated");
	} finally {
		await f.scheduler.stop();
	}
});

test("scheduler preserves persisted exponential retries and grace across restart; manual bypass remains explicit", async () => {
	const f = await fixture();
	f.web.mockRejectedValue(new Error("image not published"));
	await f.scheduler.start();
	f.scheduler.invalidate("demo");
	await f.scheduler.settle();
	expect(f.states.get("demo")).toMatchObject({
		phase: "deploying",
		failures: 1,
		retryAt: 1000,
		deploymentStartedAt: 0,
	});
	await f.scheduler.stop();
	const restarted = f.createScheduler();
	try {
		await restarted.start();
		for (const [delay, failures] of [
			[1000, 2],
			[2000, 3],
			[4000, 4],
		] as const) {
			expect(f.waits.at(-1)?.delay).toBe(delay);
			restarted.invalidate("demo");
			await restarted.settle();
			expect(f.web).toHaveBeenCalledTimes(failures - 1);
			f.advance(delay);
			f.waits.at(-1)!.finish();
			await vi.waitFor(() => expect(f.web).toHaveBeenCalledTimes(failures));
			await restarted.settle();
			expect(f.states.get("demo")).toMatchObject({ failures, phase: "deploying", deploymentStartedAt: 0 });
		}
		f.advance(300000);
		f.waits.at(-1)!.finish();
		await vi.waitFor(() => expect(f.web).toHaveBeenCalledTimes(5));
		await restarted.settle();
		expect(f.states.get("demo")).toMatchObject({ phase: "failed", failures: 5, deploymentStartedAt: 0 });
		f.web.mockResolvedValue();
		await restarted.redeploy("demo");
		await restarted.settle();
		expect(f.web.mock.calls.at(-1)?.[0].force).toBe(true);
		expect(f.states.get("demo")).toEqual({ desiredRevision: "rev", activeRevision: "rev", phase: "ready" });
	} finally {
		await restarted.stop();
	}
});
