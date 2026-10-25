import { createSocket } from "node:dgram";
import { once } from "node:events";

import type { ResourceHostPort, ServiceDescriptor } from "@homelab-paas/shared-contracts";

import { writeFile } from "../../src/util/file.ts";
import { stringifyYaml } from "../../src/util/yaml.ts";
import { test, expect } from "../util/browser-fixtures.ts";
import { waitFor } from "../util/wait.ts";

const udpVersion = async (port: number): Promise<string> => {
	const socket = createSocket("udp4");
	try {
		const response = once(socket, "message", { signal: AbortSignal.timeout(1500) });
		socket.send("version", port, "127.0.0.1");
		const [message] = await response;
		return message.toString();
	} finally {
		socket.close();
	}
};

test("host ports publish TCP and UDP for web and worker, replace bindings and default to no publication", async ({
	environment: env,
}) => {
	const bindings = (port: number): ResourceHostPort[] =>
		["tcp", "udp"].map((protocol) => ({
			protocol: protocol as "tcp" | "udp",
			containerPort: 8080,
			hostPort: port,
			bindAddress: "127.0.0.1",
		}));
	const descriptor = (offset: number, version: string, publish = true): ServiceDescriptor => ({
		version: 1,
		metadata: { serviceId: "host-ports" },
		resources: {
			app: {
				type: "web",
				image: env.image,
				ingress: { public: false, port: 8080 },
				healthcheckUrl: "/health",
				hostPorts: publish ? bindings(18080 + offset) : undefined,
				termination: { timeoutSeconds: 2 },
				env: [
					{ name: "VERSION", value: version },
					{ name: "UDP_PORT", value: "8080" },
				],
			},
			jobs: {
				type: "worker",
				image: env.image,
				healthcheckPort: 8080,
				healthcheckUrl: "/health",
				hostPorts: publish ? bindings(18081 + offset) : undefined,
				termination: { timeoutSeconds: 2 },
				env: [
					{ name: "VERSION", value: version },
					{ name: "UDP_PORT", value: "8080" },
				],
			},
		},
	});
	await env.git.commit({ "host-ports.sd.yaml": stringifyYaml(descriptor(0, "v1")) });
	env.config.services["host-ports"] = {
		remote: env.git.remote,
		branch: "main",
		descriptorPath: "host-ports.sd.yaml",
	};
	await writeFile(`${env.directory}/etc/config.yaml`, stringifyYaml(env.config), { mode: 0o600 });
	await env.compose(["restart", "paas"]);
	await waitFor("host bindings ready", async () => (await env.checkpoint("host-ports"))?.phase === "ready");
	const original = await env.workloadIds("host-ports");
	expect(original).toHaveLength(2);
	const verify = async (port: number, version: string) => {
		await waitFor(`TCP port ${port}`, async () => {
			const response = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(1500) });
			return response.ok && (await response.json()).version === version;
		});
		await waitFor(`UDP port ${port}`, async () => (await udpVersion(port)) === version);
	};
	await verify(18080, "v1");
	await verify(18081, "v1");
	// Direct publication reaches a private web resource without an Envoy session.
	expect((await env.request(env.url("host-ports", "/version"))).status).toBe(302);
	const changed = await env.git.commit({ "host-ports.sd.yaml": stringifyYaml(descriptor(10, "v1")) });
	await waitFor(
		"binding replacement ready",
		async () => (await env.checkpoint("host-ports"))?.activeRevision === changed,
	);
	const replacement = await env.workloadIds("host-ports");
	expect(replacement).toHaveLength(2);
	expect(replacement.some((id) => original.includes(id))).toBe(false);
	await verify(18090, "v1");
	await verify(18091, "v1");
	for (const port of [18080, 18081]) {
		await expect(
			fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(1500) }),
		).rejects.toThrow();
		await expect(udpVersion(port)).rejects.toThrow();
	}
	const invalid = descriptor(10, "bad");
	invalid.resources["jobs"] = {
		...invalid.resources["jobs"]!,
		hostPorts: bindings(18090),
	} as (typeof invalid.resources)[string];
	await env.git.commit({ "host-ports.sd.yaml": stringifyYaml(invalid) });
	await waitFor(
		"overlapping descriptor rejected",
		async () => (await env.checkpoint("host-ports"))?.phase === "failed",
	);
	expect((await env.workloadIds("host-ports")).sort()).toEqual(replacement.sort());
	await verify(18090, "v1");
	await verify(18091, "v1");
	const removed = await env.git.commit({ "host-ports.sd.yaml": stringifyYaml(descriptor(0, "v1", false)) });
	await waitFor(
		"host publication removed",
		async () => (await env.checkpoint("host-ports"))?.activeRevision === removed,
	);
	for (const id of await env.workloadIds("host-ports")) {
		const [container] = JSON.parse(await env.docker(["inspect", id]));
		expect(Object.keys(container.HostConfig.PortBindings ?? {})).toEqual([]);
	}
	for (const port of [18090, 18091]) {
		await expect(
			fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(1500) }),
		).rejects.toThrow();
		await expect(udpVersion(port)).rejects.toThrow();
	}
});
