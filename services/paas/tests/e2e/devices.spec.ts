import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

import { writeFile } from "../../src/util/file.ts";
import { stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

test("simple devices support web and worker access, supplementary groups and replacement", async ({
	environment: env,
}) => {
	const descriptor = (mountPath: string, group: number, attach = true): ServiceDescriptor => {
		const settings = {
			image: env.image,
			healthcheckUrl: "/health",
			termination: { timeoutSeconds: 2 },
			devices: attach ? [{ hostPath: "/dev/null", mountPath, permissions: "rw" }] : undefined,
			supplementaryGroups: attach ? [group] : undefined,
		};
		return {
			version: 1,
			metadata: { serviceId: "devices" },
			resources: {
				app: { ...settings, type: "web", ingress: { public: true, port: 8080 }, rolloutStrategy: "surge" },
				jobs: { ...settings, type: "worker", healthcheckPort: 8080 },
			},
		};
	};
	await env.git.commit({ "devices.sd.yaml": stringifyYaml(descriptor("/dev/test-null", 12345)) });
	env.config.services["devices"] = { remote: env.git.remote, branch: "main", descriptorPath: "devices.sd.yaml" };
	await writeFile(`${env.directory}/etc/config.yaml`, stringifyYaml(env.config), { mode: 0o600 });
	await env.compose(["restart", "paas"]);
	await waitFor("device workloads ready", async () => (await env.checkpoint("devices"))?.phase === "ready");
	const verify = async (mountPath: string, group: number) => {
		const ids = await env.workloadIds("devices");
		expect(ids).toHaveLength(2);
		for (const id of ids) {
			const [container] = JSON.parse(await env.docker(["inspect", id]));
			expect(container.HostConfig.Devices).toEqual([
				{ PathOnHost: "/dev/null", PathInContainer: mountPath, CgroupPermissions: "rw" },
			]);
			expect(container.HostConfig.GroupAdd).toEqual([String(group)]);
			expect(container.HostConfig.Privileged).toBe(false);
			expect(container.HostConfig.DeviceRequests ?? []).toEqual([]);
			await env.docker([
				"exec",
				id,
				"sh",
				"-c",
				'test -c "$1" && dd if="$1" of=/dev/null count=1 && dd if=/dev/zero of="$1" count=1',
				"sh",
				mountPath,
			]);
			expect((await env.docker(["exec", id, "id", "-G"])).trim().split(/\s+/)).toContain(String(group));
			expect(
				(await env.docker(["exec", id, "sed", "-n", "/^Groups:/p", "/proc/1/status"])).trim().split(/\s+/),
			).toContain(String(group));
		}
		return ids;
	};
	const original = await verify("/dev/test-null", 12345);
	const changed = await env.git.commit({ "devices.sd.yaml": stringifyYaml(descriptor("/dev/other-null", 12346)) });
	await waitFor(
		"device replacement ready",
		async () => (await env.checkpoint("devices"))?.activeRevision === changed,
	);
	const replacements = await verify("/dev/other-null", 12346);
	expect(replacements.some((id) => original.includes(id))).toBe(false);
	const removed = await env.git.commit({
		"devices.sd.yaml": stringifyYaml(descriptor("/dev/other-null", 12346, false)),
	});
	await waitFor("device removal ready", async () => (await env.checkpoint("devices"))?.activeRevision === removed);
	for (const id of await env.workloadIds("devices")) {
		const [container] = JSON.parse(await env.docker(["inspect", id]));
		expect(container.HostConfig.Devices ?? []).toEqual([]);
		expect(container.HostConfig.GroupAdd ?? []).toEqual([]);
		await env.docker(["exec", id, "sh", "-c", "test ! -e /dev/other-null"]);
	}
});
