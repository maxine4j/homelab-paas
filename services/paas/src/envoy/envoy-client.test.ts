import { expect, test } from "vitest";
import yaml from "yaml";
import { z } from "zod";

import { EnvoyClient } from "./envoy-client.ts";
import type { IEnvoyTransport } from "./envoy-transport.ts";
import { EnvoyClientError, type EnvoyConfiguration } from "./types.ts";

const configuration: EnvoyConfiguration = {
	clusters: [{ name: "service-demo", "@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster" }],
	listeners: [{ name: "http", "@type": "type.googleapis.com/envoy.config.listener.v3.Listener" }],
};
const discoverySchema = z.object({ version_info: z.string(), resources: z.array(z.object({ name: z.string() })) });

function fixture() {
	const calls: string[] = [];
	const files = new Map<string, z.infer<typeof discoverySchema>>();
	const transport: IEnvoyTransport = {
		async writeDiscoveryFile(name, content) {
			calls.push(name);
			files.set(name, discoverySchema.parse(yaml.parse(content)));
		},
		async readConfigDump() {
			calls.push("dump");
			const cds = files.get("cds.yaml");
			const lds = files.get("lds.yaml");
			return {
				status: 200,
				body: JSON.stringify({
					configs: [
						{
							"@type": "type.googleapis.com/envoy.admin.v3.ClustersConfigDump",
							version_info: cds?.version_info,
							dynamic_active_clusters: cds?.resources.map((cluster) => ({
								cluster,
								version_info: "unchanged-resource-version",
							})),
						},
						{
							"@type": "type.googleapis.com/envoy.admin.v3.ListenersConfigDump",
							version_info: lds?.version_info,
							dynamic_listeners: lds?.resources.map((listener) => ({
								name: listener.name,
								active_state: { listener },
							})),
						},
					],
				}),
			};
		},
	};
	const sleep = async () => {
		calls.push("sleep");
	};
	return { transport, calls, files, client: new EnvoyClient(transport, sleep, { attempts: 3, intervalMs: 1 }) };
}

test("publishes deterministic discovery versions and confirms clusters before listeners", async () => {
	const f = fixture();
	await f.client.apply(configuration);
	expect(f.calls).toEqual(["cds.yaml", "dump", "lds.yaml", "dump"]);
	const previous = f.files.get("cds.yaml")?.version_info;
	await f.client.apply(configuration);
	expect(f.files.get("cds.yaml")?.version_info).toBe(previous);
});

test("file publication alone cannot confirm acceptance; polling is bounded", async () => {
	const f = fixture();
	f.transport.readConfigDump = async () => {
		f.calls.push("dump");
		return { status: 200, body: '{"configs":[]}' };
	};
	await expect(f.client.apply(configuration)).rejects.toThrow(EnvoyClientError);
	expect(f.calls).toEqual(["cds.yaml", "dump", "sleep", "dump", "sleep", "dump"]);
});

test("retries pending configuration and resolves after it becomes active", async () => {
	const f = fixture();
	const read = f.transport.readConfigDump.bind(f.transport);
	let reads = 0;
	f.transport.readConfigDump = async () => {
		if (++reads === 1) return { status: 200, body: '{"configs":[]}' };
		return read();
	};
	await f.client.apply(configuration);
	expect(f.calls).toEqual(["cds.yaml", "sleep", "dump", "lds.yaml", "dump"]);
});

test.each(["warming", "missing-active", "stale-version"])("does not accept %s clusters", async (state) => {
	const f = fixture();
	f.transport.readConfigDump = async () => ({
		status: 200,
		body: JSON.stringify({
			configs: [
				{
					"@type": "type.googleapis.com/envoy.admin.v3.ClustersConfigDump",
					version_info: state === "stale-version" ? "old" : f.files.get("cds.yaml")?.version_info,
					dynamic_active_clusters: state === "missing-active" ? [] : [{ cluster: { name: "service-demo" } }],
					dynamic_warming_clusters: state === "warming" ? [{}] : [],
				},
			],
		}),
	});
	await expect(f.client.apply(configuration)).rejects.toThrow(EnvoyClientError);
	expect(f.files.has("lds.yaml")).toBe(false);
});

test("waits for the active listener rather than accepting a warming replacement", async () => {
	const f = fixture();
	const read = f.transport.readConfigDump.bind(f.transport);
	f.transport.readConfigDump = async () => {
		if (!f.files.has("lds.yaml")) return read();
		return {
			status: 200,
			body: JSON.stringify({
				configs: [
					{
						"@type": "type.googleapis.com/envoy.admin.v3.ListenersConfigDump",
						version_info: f.files.get("lds.yaml")?.version_info,
						dynamic_listeners: [
							{ name: "http", active_state: { listener: { name: "http" } }, warming_state: {} },
						],
					},
				],
			}),
		};
	};
	await expect(f.client.apply(configuration)).rejects.toThrow(EnvoyClientError);
});

test.each([
	{ status: 503, body: "private response" },
	{ status: 200, body: "invalid json" },
	{ status: 200, body: '{"configs":"invalid"}' },
	{
		status: 200,
		body: '{"configs":[{"@type":"type.googleapis.com/envoy.admin.v3.ClustersConfigDump","dynamic_active_clusters":"invalid"}]}',
	},
])("sanitizes unsuccessful or malformed admin responses", async (response) => {
	const f = fixture();
	f.transport.readConfigDump = async () => response;
	await expect(f.client.apply(configuration)).rejects.toThrow(new EnvoyClientError());
});

test("sanitizes transport failures", async () => {
	const f = fixture();
	f.transport.writeDiscoveryFile = async () => {
		throw new Error("secret file details");
	};
	await expect(f.client.apply(configuration)).rejects.toThrow(new EnvoyClientError());
});
