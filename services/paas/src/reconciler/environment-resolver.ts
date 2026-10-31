import type { EnvironmentVariable, UiSecretFailure } from "@homelab-paas/shared-contracts";

import { parseSecretEnv, SecretFileSyntaxError } from "../config/secret-env.ts";
import type { IHostPathResolver } from "../docker/docker-host-path-resolver.ts";
import type { FileReader } from "../util/file.ts";
import { createLogger } from "../util/logger.ts";

export interface IEnvironmentResolver {
	/** Resolves only declared values, reading secrets anew per call. Throws sanitized errors before deployment. */
	resolve(serviceId: string, env: EnvironmentVariable[]): Promise<{ name: string; value: string }[]>;
}

export class EnvironmentResolutionError extends Error {
	override readonly name = "EnvironmentResolutionError";
	constructor(
		public readonly details: UiSecretFailure,
		options?: ErrorOptions,
	) {
		super(
			`Cannot resolve application secrets; check the service env file and required variable names. Open the service Secrets tab in the web GUI${details.missingVariables?.length ? ` and set: ${details.missingVariables.join(", ")}` : " to configure secrets"}. ${details.reason}: ${details.hostFilePath ?? details.filePath}${details.line ? `, line ${details.line}` : ""}${details.missingVariables?.length ? `; missing variables: ${details.missingVariables.join(", ")}` : ""}`,
			options,
		);
	}
}

export class EnvironmentResolver implements IEnvironmentResolver {
	private readonly log = createLogger(EnvironmentResolver.name);
	constructor(
		private readonly directory: string,
		private readonly read: FileReader,
		private readonly hostPaths?: IHostPathResolver,
	) {}

	async resolve(serviceId: string, env: EnvironmentVariable[]): Promise<{ name: string; value: string }[]> {
		if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId))
			throw new Error("Cannot resolve application secrets; invalid service identity");
		const filePath = `${this.directory}/${serviceId}.env`;
		let reason: UiSecretFailure["reason"] = "unreadable-file";
		let missingVariables: string[] | undefined;
		try {
			let secrets = new Map<string, string>();
			if (env.some((entry) => "secret" in entry)) {
				const content = await this.read(filePath);
				if (content === undefined) {
					reason = "missing-file";
					missingVariables = env.filter((entry) => "secret" in entry).map((entry) => entry.name);
					throw new Error("Service secret file is missing");
				}
				reason = "invalid-file";
				if (content.includes("\0")) throw new Error("Secret file contains NUL bytes");
				secrets = parseSecretEnv(content);
				missingVariables = env
					.filter((entry) => "secret" in entry && !secrets.has(entry.name))
					.map((entry) => entry.name);
				if (missingVariables.length) {
					reason = "missing-variables";
					throw new Error("Required secret variables are missing");
				}
			}
			return env.map((entry) => {
				const value = "value" in entry ? entry.value : secrets.get(entry.name);
				if (value === undefined) throw new Error();
				return { name: entry.name, value };
			});
		} catch (cause) {
			let hostFilePath: string | undefined;
			try {
				hostFilePath = await this.hostPaths?.resolve(filePath);
			} catch (error) {
				this.log.warn(
					{ event: "secrets.host-path-unavailable", serviceId, err: error },
					"Cannot resolve host secret file path; check Docker control-plane mounts",
				);
			}
			throw new EnvironmentResolutionError(
				{
					reason,
					filePath,
					...(hostFilePath ? { hostFilePath } : {}),
					...(missingVariables?.length ? { missingVariables } : {}),
					...(cause instanceof SecretFileSyntaxError ? { line: cause.line } : {}),
				},
				{ cause },
			);
		}
	}
}
