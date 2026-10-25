import { z } from "zod";

import { readFile } from "../../src/util/file.ts";
import { parseYaml } from "../../src/util/yaml.ts";
import { MockHttpServer } from "../util/http-server.ts";

const discovery = z.object({ version_info: z.string(), resources: z.array(z.object({ name: z.string() })) });

/** Only config_dump: reads published bytes, independently describes active/warming resources. */
export class MockEnvoy {
	reject = false;
	readonly server: MockHttpServer;
	constructor(directory: string, journal: string[]) {
		this.server = new MockHttpServer(async ({ method, url }) => {
			if (method !== "GET" || url.pathname !== "/config_dump") return undefined;
			const cds = discovery.parse(parseYaml((await readFile(`${directory}/cds.yaml`))!, "mock CDS"));
			const lds = discovery.parse(parseYaml((await readFile(`${directory}/lds.yaml`))!, "mock LDS"));
			journal.push(`envoy:${cds.resources.map(({ name }) => name).join(",")}`);
			return Response.json({
				configs: [
					{
						"@type": "type.googleapis.com/envoy.admin.v3.ClustersConfigDump",
						version_info: cds.version_info,
						dynamic_active_clusters: cds.resources.map((cluster) => ({ cluster })),
						dynamic_warming_clusters: this.reject ? [{}] : [],
					},
					{
						"@type": "type.googleapis.com/envoy.admin.v3.ListenersConfigDump",
						version_info: lds.version_info,
						dynamic_listeners: lds.resources.map((listener) => ({
							name: listener.name,
							active_state: { listener },
						})),
					},
				],
			});
		});
	}
}
