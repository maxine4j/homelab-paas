import type { HealthStatus, WebResource } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import type { ServiceContainer } from "../docker/types.ts";
import { ResourceSpecification } from "../reconciler/resource-specification.ts";
import { ResourceStatusService } from "./resource-status-service.ts";

const fixture = () => {
	const resource: WebResource = {
		type: "web",
		image: "app:1",
		ingress: { port: 80, public: true },
		env: [{ name: "TOKEN", secret: true }],
	};
	const specification = new ResourceSpecification();
	const resolve = vi.fn(async () => [{ name: "TOKEN", value: "secret" }]);
	const service = new ResourceStatusService(specification, { resolve });
	const containers: ServiceContainer[] = [
		{
			id: "c",
			resourceId: "app",
			revision: "older-commit",
			spec: specification.get("app", { ...resource, primary: true, env: [{ name: "TOKEN", value: "secret" }] }),
			imageId: "image",
			state: "running",
		},
	];
	const request = {
		serviceId: "demo",
		resourceId: "app",
		resource: { ...resource, primary: true },
		descriptorAvailable: true,
		containers,
	};
	return { service, resolve, request };
};

test("sync compares resolved specifications independently of revision and readiness", async () => {
	const f = fixture();
	expect(await f.service.getSync(f.request)).toBe("Synced");
	f.request.containers[0]!.state = "exited";
	expect(await f.service.getSync(f.request)).toBe("Synced");
	f.resolve.mockResolvedValue([{ name: "TOKEN", value: "rotated" }]);
	expect(await f.service.getSync(f.request)).toBe("OutOfSync");
});

test("missing, extra and changed resources are OutOfSync", async () => {
	const f = fixture();
	expect(await f.service.getSync({ ...f.request, containers: [] })).toBe("OutOfSync");
	expect(await f.service.getSync({ ...f.request, resource: undefined })).toBe("OutOfSync");
	expect(await f.service.getSync({ ...f.request, resource: { ...f.request.resource, image: "app:2" } })).toBe(
		"OutOfSync",
	);
	expect(
		await f.service.getSync({
			...f.request,
			containers: [...f.request.containers, { ...f.request.containers[0]!, id: "extra" }],
		}),
	).toBe("OutOfSync");
});

test("unavailable desired state and secret resolution report Unknown", async () => {
	const f = fixture();
	expect(await f.service.getSync({ ...f.request, descriptorAvailable: false })).toBe("Unknown");
	f.resolve.mockRejectedValue(new Error("secret failure"));
	expect(await f.service.getSync(f.request)).toBe("Unknown");
	expect(await f.service.getSync({ ...f.request, resource: { type: "postgres", image: "postgres:17" } })).toBe(
		"Unknown",
	);
});

test("service sync and health aggregate independently", () => {
	const { service } = fixture();
	expect(service.aggregate([{ sync: "OutOfSync", health: "Healthy" }])).toEqual({
		sync: "OutOfSync",
		health: "Healthy",
	});
	expect(service.aggregate([{ sync: "Synced", health: "Degraded" }])).toEqual({ sync: "Synced", health: "Degraded" });
	expect(
		service.aggregate([
			{ sync: "Synced", health: "Healthy" },
			{ sync: "Unknown", health: "Healthy" },
		]),
	).toEqual({ sync: "Unknown", health: "Healthy" });
	expect(service.aggregate([])).toEqual({ sync: "Unknown", health: "Unknown" });
});

test("health aggregation follows Argo severity regardless of resource order", () => {
	const { service } = fixture();
	const states: HealthStatus[] = ["Healthy", "Progressing", "Missing", "Degraded", "Unknown"];
	for (let index = 0; index < states.length; index++) {
		const resources = states.slice(0, index + 1).map((health) => ({ sync: "Synced" as const, health }));
		expect(service.aggregate(resources).health).toBe(states[index]);
		expect(service.aggregate(resources.reverse()).health).toBe(states[index]);
	}
});
