import { createHash } from "node:crypto";

import { z } from "zod";

import type { ISleep } from "../util/sleep.ts";
import { stringifyYaml } from "../util/yaml.ts";
import type { IEnvoyTransport } from "./envoy-transport.ts";
import { EnvoyClientError, type EnvoyConfiguration, type EnvoyResource } from "./types.ts";

export interface IEnvoyClient {
	/** Seed missing discovery files; preserve existing state. Rejects with EnvoyClientError. */
	bootstrap(): Promise<void>;
	/** Publish and confirm active configuration. Rejects with EnvoyClientError;
	 * publication may have occurred. Callers serialize all updates.
	 */
	apply(configuration: EnvoyConfiguration): Promise<void>;
}

/** xDS serialization, response validation, and bounded acceptance polling. */
export class EnvoyClient implements IEnvoyClient {
	constructor(
		private readonly transport: IEnvoyTransport,
		private readonly sleep: ISleep,
		private readonly polling: { attempts: number; intervalMs: number },
	) {
		if (
			!Number.isInteger(polling.attempts)
			|| polling.attempts < 1
			|| !Number.isFinite(polling.intervalMs)
			|| polling.intervalMs < 0
		)
			throw new EnvoyClientError();
	}

	async apply(configuration: EnvoyConfiguration): Promise<void> {
		try {
			await this.publish("cds", configuration.clusters);
			await this.publish("lds", configuration.listeners);
		} catch {
			throw new EnvoyClientError();
		}
	}

	async bootstrap(): Promise<void> {
		try {
			const content = stringifyYaml({ version_info: "bootstrap", resources: [] });
			await this.transport.createDiscoveryFile("cds.yaml", content);
			await this.transport.createDiscoveryFile("lds.yaml", content);
		} catch {
			throw new EnvoyClientError();
		}
	}

	private async publish(kind: "cds" | "lds", resources: EnvoyResource[]): Promise<void> {
		const version = createHash("sha256").update(JSON.stringify(resources)).digest("hex");
		await this.transport.writeDiscoveryFile(`${kind}.yaml`, stringifyYaml({ version_info: version, resources }));
		const names = resources.map(({ name }) => name).sort();
		for (let attempt = 0; attempt < this.polling.attempts; attempt++) {
			// The bootstrap starts Envoy only after the control-plane health server is up.
			const response = await this.transport.readConfigDump().catch(() => undefined);
			if (response) {
				if (response.status !== 200) throw new EnvoyClientError();
				const dump = dumpSchema.parse(JSON.parse(response.body));
				const type = kind === "cds" ? "ClustersConfigDump" : "ListenersConfigDump";
				const config = dump.configs.find(
					(entry) => entry["@type"] === `type.googleapis.com/envoy.admin.v3.${type}`,
				);
				if (config && this.accepted(kind, config, version, names)) return;
			}
			if (attempt + 1 < this.polling.attempts) await this.sleep(this.polling.intervalMs);
		}
		throw new EnvoyClientError();
	}

	private accepted(kind: "cds" | "lds", value: unknown, version: string, names: string[]): boolean {
		if (kind === "cds") {
			const config = clustersSchema.parse(value);
			return (
				config.version_info === version
				&& config.dynamic_warming_clusters.length === 0
				&& JSON.stringify(config.dynamic_active_clusters.map(({ cluster }) => cluster.name).sort())
					=== JSON.stringify(names)
			);
		}
		const config = listenersSchema.parse(value);
		return (
			config.version_info === version
			&& config.dynamic_listeners.every((listener) => listener.warming_state === undefined)
			&& JSON.stringify(
				config.dynamic_listeners
					.flatMap(({ active_state }) => (active_state ? [active_state.listener.name] : []))
					.sort(),
			) === JSON.stringify(names)
		);
	}
}

const dumpSchema = z.object({ configs: z.array(z.object({ "@type": z.string() }).passthrough()) });
const namedResource = z.object({ name: z.string() });
const clustersSchema = z.object({
	version_info: z.string().default(""),
	dynamic_active_clusters: z.array(z.object({ cluster: namedResource })).default([]),
	dynamic_warming_clusters: z.array(z.unknown()).default([]),
});
const listenersSchema = z.object({
	version_info: z.string().default(""),
	dynamic_listeners: z
		.array(
			z.object({
				name: z.string(),
				active_state: z.object({ listener: namedResource }).optional(),
				warming_state: z.unknown().optional(),
			}),
		)
		.default([]),
});
