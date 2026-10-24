import type { EnvironmentVariable } from "@homelab-paas/shared-contracts";

import type { FileReader } from "../util/file.ts";

export interface IEnvironmentResolver {
	/** Resolves only declared values, reading secrets anew per call. Throws sanitized errors before deployment. */
	resolve(serviceId: string, env: EnvironmentVariable[]): Promise<{ name: string; value: string }[]>;
}

export class EnvironmentResolver implements IEnvironmentResolver {
	constructor(
		private readonly directory: string,
		private readonly read: FileReader,
	) {}

	async resolve(serviceId: string, env: EnvironmentVariable[]): Promise<{ name: string; value: string }[]> {
		try {
			if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId)) throw new Error();
			let secrets = new Map<string, string>();
			if (env.some((entry) => "secret" in entry)) {
				const content = await this.read(`${this.directory}/${serviceId}.env`);
				if (content === undefined || content.includes("\0")) throw new Error();
				secrets = this.parse(content);
			}
			return env.map((entry) => {
				const value = "value" in entry ? entry.value : secrets.get(entry.name);
				if (value === undefined) throw new Error();
				return { name: entry.name, value };
			});
		} catch (cause) {
			throw new Error(
				"Cannot resolve application secrets; check the service env file and required variable names",
				{ cause },
			);
		}
	}

	private parse(content: string): Map<string, string> {
		const values = new Map<string, string>();
		for (const line of content.split(/\r?\n/)) {
			if (/^\s*(?:#.*)?$/.test(line)) continue;
			// Single-line dotenv assignments; quoting is literal, without shell expansion.
			const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^'"#]*?))\s*(?:#.*)?$/.exec(
				line,
			);
			const name = match?.at(1);
			if (!name || values.has(name)) throw new Error();
			values.set(name, match?.at(2) ?? match?.at(3) ?? match?.at(4)?.trim() ?? "");
		}
		return values;
	}
}
