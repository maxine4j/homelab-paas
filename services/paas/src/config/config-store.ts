import { createHash } from "node:crypto";

import type { FileReader, FileWriter } from "../util/file.ts";
import { parseYaml, stringifyYaml } from "../util/yaml.ts";
import type { ConfigDocument } from "./types.ts";

const CONFIG_PATH = "/etc/homelab-paas/config.yaml";

export interface IConfigStore {
	/** Reads parsed YAML and an opaque content revision; throws a sanitized infrastructure error. */
	read(): Promise<ConfigDocument>;
	/** Atomically replaces YAML with restricted permissions; throws without publishing on failure. */
	write(value: unknown): Promise<ConfigDocument>;
}

export class FileConfigStore implements IConfigStore {
	constructor(
		private readonly readFile: FileReader,
		private readonly writeFile: FileWriter,
	) {}
	async read(): Promise<ConfigDocument> {
		try {
			const content = await this.readFile(CONFIG_PATH);
			if (!content) throw new Error("Configuration file is missing or empty");
			return this.document(content);
		} catch (cause) {
			throw new Error(
				"Cannot load platform configuration; check /etc/homelab-paas/config.yaml against the platform configuration contract",
				{ cause },
			);
		}
	}
	async write(value: unknown): Promise<ConfigDocument> {
		try {
			const content = stringifyYaml(value);
			const document = this.document(content);
			await this.writeFile(CONFIG_PATH, content, { mode: 0o600 });
			return document;
		} catch (cause) {
			throw new Error("Cannot save platform configuration", { cause });
		}
	}
	private document(content: string): ConfigDocument {
		return { value: parseYaml(content, CONFIG_PATH), revision: createHash("sha256").update(content).digest("hex") };
	}
}
