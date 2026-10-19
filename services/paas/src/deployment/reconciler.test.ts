import { expect, test } from "vitest";

import { parseConfig, parseDescriptor } from "./config.ts";
import { DeploymentError, type Container, type DeploymentStatus, type WorkloadClient } from "./contracts.ts";
import { Reconciler } from "./reconciler.ts";

function fixture() {
	const calls: string[] = [];
	const statuses: DeploymentStatus[] = [];
	let containers: Container[] = [];
	let revision = "commit1";
	let content = "valid";
	let clock = 0;
	let failReady = false;
	const resource = { type: "web", image: "app:1", ingress: { public: true, port: 8080 } };
	const config = parseConfig({
		version: 1,
		metadata: { clusterId: "local" },
		ingress: { baseDomain: "localhost" },
		git: { pollIntervalSeconds: 5, operationTimeoutSeconds: 60 },
		reconciliation: { retryBackoffSeconds: 5, maxRetryBackoffSeconds: 10 },
		services: { demo: { remote: "local", descriptorPath: "/repo/demo.sd.yaml" } },
	});
	const workloads: WorkloadClient = {
		async prepareNetwork() {
			calls.push("network");
		},
		async list() {
			return containers;
		},
		async resolveImage() {
			calls.push("image");
			return "sha256:image";
		},
		async create(_service, resourceId, rev, spec) {
			calls.push("create");
			containers = [{ id: "new", resourceId, revision: rev, spec, running: false }];
			return "new";
		},
		async start() {
			calls.push("start");
			containers.forEach((c) => (c.running = true));
		},
		async stop() {
			calls.push("stop");
		},
		async remove() {
			calls.push("remove");
			containers = [];
		},
		async waitReady() {
			calls.push("ready");
			if (failReady) throw new DeploymentError("Readiness failed");
			return { address: "10.0.0.2", port: 8080 };
		},
	};
	const reconciler = new Reconciler({
		config,
		workloads,
		source: {
			async read() {
				calls.push("git");
				if (content === "git-fail") throw new DeploymentError("Git unavailable");
				return { revision, content };
			},
		},
		decode(value, serviceId) {
			return parseDescriptor(
				{
					version: 1,
					metadata: { serviceId },
					resources: { app: value === "invalid" ? { type: "postgres" } : resource },
				},
				serviceId,
			);
		},
		routes: {
			async set(_service, endpoint) {
				calls.push(endpoint ? "route" : "withdraw");
			},
		},
		state: {
			async write(_service, state) {
				statuses.push(state);
			},
		},
		now: () => clock,
		report() {},
	});
	return {
		reconciler,
		calls,
		statuses,
		setRevision: (value: string) => (revision = value),
		setContent: (value: string) => (content = value),
		advance: (ms: number) => (clock += ms),
		failReadiness: () => (failReady = true),
		stopContainer: () => containers.forEach((c) => (c.running = false)),
	};
}

test("startup deploys a committed descriptor and routes only after readiness; polls do not recreate unchanged specs", async () => {
	const f = fixture();
	await f.reconciler.run();
	expect(f.calls).toEqual(["git", "network", "image", "withdraw", "create", "start", "ready", "route"]);
	expect(f.statuses.at(-1)).toMatchObject({ activeRevision: "commit1", phase: "ready" });
	f.calls.length = 0;
	f.setRevision("commit2");
	await f.reconciler.run();
	expect(f.calls).toEqual(["git", "network", "ready", "route"]);
	expect(f.statuses.at(-1)).toMatchObject({ desiredRevision: "commit2", activeRevision: "commit1" });
});
test("invalid descriptors and Git failures preserve existing workloads and routes, and retry with bounded backoff", async () => {
	const f = fixture();
	await f.reconciler.run();
	f.calls.length = 0;
	f.setContent("invalid");
	await f.reconciler.run();
	expect(f.calls).toEqual(["git"]);
	expect(f.statuses.at(-1)?.phase).toBe("failed");
	f.calls.length = 0;
	await f.reconciler.run();
	expect(f.calls).toEqual([]);
	f.advance(5000);
	f.setContent("git-fail");
	await f.reconciler.run();
	expect(f.calls).toEqual(["git"]);
	f.calls.length = 0;
	f.advance(9999);
	await f.reconciler.run();
	expect(f.calls).toEqual([]);
	f.advance(1);
	f.setContent("valid");
	await f.reconciler.run();
	expect(f.calls).toContain("route");
});
test("recovers stopped containers and never publishes an unready replacement", async () => {
	const f = fixture();
	await f.reconciler.run();
	f.stopContainer();
	f.calls.length = 0;
	await f.reconciler.run();
	expect(f.calls).toEqual(["git", "network", "start", "ready", "route"]);
	f.failReadiness();
	f.calls.length = 0;
	await f.reconciler.run();
	expect(f.calls).toContain("withdraw");
	expect(f.calls).not.toContain("route");
	expect(f.statuses.at(-1)).toMatchObject({ phase: "failed", error: "Readiness failed" });
});
test("overlapping polling requests are serialized", async () => {
	const f = fixture();
	await Promise.all([f.reconciler.run(), f.reconciler.run()]);
	expect(f.calls.filter((call) => call === "create")).toHaveLength(1);
});
