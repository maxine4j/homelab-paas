import { expect, test } from "vitest";

import type { DeploymentWebResource } from "./deployment/strategy/types.ts";
import type { DeploymentWorkerResource } from "./deployment/types.ts";
import { ResourceSpecification } from "./resource-specification.ts";

const specification = new ResourceSpecification();
const web: DeploymentWebResource = { type: "web", image: "app:1", ingress: { public: true, port: 8080 } };
const worker: DeploymentWorkerResource = { type: "worker", image: "app:1", healthcheckPort: 9090 };
const settings = {
	selinuxLabeling: false,
	command: ["app", "--serve"],
	env: [
		{ name: "Z", value: "last" },
		{ name: "A", value: "old" },
		{ name: "A", value: "resolved-secret" },
	],
	volumes: [
		{ hostPath: "/srv/default", mountPath: "/default" },
		{ hostPath: "/srv/owned", mountPath: "/owned", ownership: { uid: 123, gid: 456 } },
		{ hostPath: "/srv/unowned", mountPath: "/unowned", ownership: false },
		{ hostPath: "/srv/readonly", mountPath: "/readonly", readOnly: true, ownership: { uid: 7, gid: 8 } },
	],
	devices: [
		{ hostPath: "/dev/dri", mountPath: "/dev/dri" },
		{ hostPath: "/dev/video0", mountPath: "/dev/video1", permissions: "rw" },
	],
	supplementaryGroups: [44, 7],
	hostPorts: [{ protocol: "tcp", containerPort: 8080, hostPort: 18080, bindAddress: "127.0.0.1" }],
	limits: { cpus: 1.5, memoryMiB: 512 },
	replicas: 1,
	rolloutStrategy: "recreate",
	healthcheckUrl: "/ready",
	termination: { timeoutSeconds: 60 },
} satisfies Partial<DeploymentWorkerResource>;

test.each([
	["web defaults", web, "322492ebf33fa5dc30c942702da4ef5c2db37987d1014608fe7386f422dff859"],
	["worker defaults", worker, "a16525387caa645120bc53469810ea9ef16985a2b0306f9c52e72fe89f68d78e"],
	[
		"web settings",
		{ ...web, ...settings, primary: true },
		"bce8ae5a285c2a593ddcd9906b6ad58f4f30db6feb541fb1539d1021d485c4e2",
	],
	["worker settings", { ...worker, ...settings }, "7668dd5cb031f8ff8c61a8de8d51acee5fa1b2532e3f4080bb77412387b932a6"],
])("retains the persisted hash for %s", (_name, resource, hash) => {
	expect(specification.get("app", resource)).toBe(hash);
});

test.each([web, worker])("normalizes explicit defaults for $type", (resource) => {
	expect(
		specification.get("app", {
			...resource,
			selinuxLabeling: true,
			env: [],
			volumes: [],
			devices: [],
			supplementaryGroups: [],
			hostPorts: [],
			limits: {},
			replicas: 1,
			rolloutStrategy: "recreate",
			healthcheckUrl: null,
			termination: { timeoutSeconds: 30 },
		}),
	).toBe(specification.get("app", resource));
});

test.each([web, worker])("normalizes equivalent settings for $type", (resource) => {
	expect(
		specification.get("app", {
			...resource,
			...settings,
			env: [
				{ name: "A", value: "resolved-secret" },
				{ name: "Z", value: "last" },
			],
			supplementaryGroups: [7, 44],
			devices: settings.devices.map((device) => ({ permissions: "rwm", ...device })),
			volumes: settings.volumes.map((volume) => ({ readOnly: false, ...volume })),
		}),
	).toBe(specification.get("app", { ...resource, ...settings }));
});

test("primary selection does not change the container hash", () => {
	expect(specification.get("app", { ...web, primary: true })).toBe(specification.get("app", web));
	expect(specification.get("app", { ...web, primary: false })).toBe(specification.get("app", web));
});
