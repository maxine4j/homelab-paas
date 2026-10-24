import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";
import { parseDescriptor } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import type { GitFileSource } from "../git/types.ts";
import type { FileReader } from "../util/file.ts";
import { parseYaml } from "../util/yaml.ts";

const PAAS_CONFIG_PATH = "/etc/homelab-paas/config.yaml";

export class PaasConfig {
	constructor(
		private readonly readFile: FileReader,
		private readonly environment: Readonly<Record<string, string | undefined>> = {},
	) {}
	async load(): Promise<PlatformConfig> {
		try {
			const fileContent = await this.readFile(PAAS_CONFIG_PATH);
			if (!fileContent) throw Error();
			const value = z
				.object({
					auth: z
						.object({
							github: z.record(z.string(), z.unknown()),
							session: z.record(z.string(), z.unknown()),
						})
						.passthrough()
						.optional(),
					tls: z
						.object({
							acme: z.record(z.string(), z.unknown()),
							dns: z.object({ credentials: z.record(z.string(), z.unknown()) }).passthrough(),
						})
						.passthrough()
						.optional(),
				})
				.passthrough()
				.parse(parseYaml(fileContent, PAAS_CONFIG_PATH));
			if (value.auth) {
				const github = value.auth.github;
				if (this.environment["GITHUB_CLIENT_ID"] !== undefined)
					github["clientId"] = this.environment["GITHUB_CLIENT_ID"];
				if (this.environment["GITHUB_CLIENT_SECRET"] !== undefined)
					github["clientSecret"] = this.environment["GITHUB_CLIENT_SECRET"];
				if (this.environment["SESSION_SIGNING_KEY"] !== undefined)
					value.auth.session["signingKey"] = this.environment["SESSION_SIGNING_KEY"];
			}
			if (value.tls) {
				if (this.environment["ACME_EMAIL"] !== undefined)
					value.tls.acme["email"] = this.environment["ACME_EMAIL"];
				if (this.environment["DIGITALOCEAN_API_TOKEN"] !== undefined)
					value.tls.dns.credentials["apiToken"] = this.environment["DIGITALOCEAN_API_TOKEN"];
			}
			return parseConfig(value);
		} catch (cause) {
			throw new Error(
				"Cannot load platform configuration; check /etc/homelab-paas/config.yaml against the platform configuration contract",
				{ cause },
			);
		}
	}
}

export function decodeDescriptorYaml(content: string, serviceId: string): ServiceDescriptor {
	try {
		return parseDescriptor(parseYaml(content, `${serviceId}.sd.yaml`), serviceId);
	} catch (cause) {
		throw new Error("Invalid service descriptor: check service identity and resource configuration", { cause });
	}
}

const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const positive = z.number().int().positive();
const port = positive.max(65535);
const auth = z.strictObject({
	github: z.strictObject({
		clientId: z.string().min(1),
		clientSecret: z.string().min(1),
		allowedUsers: z.array(z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/)).min(1),
	}),
	session: z.strictObject({
		issuer: z.string().min(1),
		audience: z.string().min(1),
		signingKey: z.string().min(32),
		ttlSeconds: positive,
	}),
});
const tls = z.strictObject({
	acme: z.strictObject({ email: z.email() }),
	dns: z.strictObject({
		provider: z.literal("digitalocean"),
		credentials: z.strictObject({ apiToken: z.string().min(1) }),
	}),
});
const source = z.strictObject({
	remote: z.string().min(1),
	branch: z
		.string()
		.min(1)
		.refine((branch) => !branch.startsWith("-"))
		.optional(),
	descriptorPath: z.string().min(1).optional(),
});
const config = z.strictObject({
	version: z.literal(1),
	metadata: z.strictObject({ clusterId: id }),
	ingress: z.strictObject({
		baseDomain: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
		httpPort: port.default(80),
		httpsPort: port.optional(),
	}),
	auth: auth.optional(),
	tls: tls.optional(),
	git: z.strictObject({ pollIntervalSeconds: positive, operationTimeoutSeconds: positive }),
	reconciliation: z.strictObject({ retryBackoffSeconds: positive, maxRetryBackoffSeconds: positive }),
	services: z.record(id, source),
});
export interface PlatformConfig {
	version: 1;
	metadata: { clusterId: string };
	ingress: { baseDomain: string; httpPort: number; httpsPort?: number };
	auth?: z.infer<typeof auth>;
	tls?: z.infer<typeof tls>;
	git: { pollIntervalSeconds: number; operationTimeoutSeconds: number };
	reconciliation: { retryBackoffSeconds: number; maxRetryBackoffSeconds: number };
	services: Record<string, GitFileSource>;
}

export function parseConfig(value: unknown): PlatformConfig {
	const result = config.safeParse(value);
	if (!result.success) throw new Error("Invalid platform configuration", { cause: result.error });
	const { data } = result;
	if (Boolean(data.auth) !== Boolean(data.tls) || (!data.tls && data.ingress.httpsPort !== undefined))
		throw new Error("Invalid platform configuration: auth and TLS must be configured together");
	if (data.auth) {
		data.ingress.httpsPort ??= 443;
		if (data.ingress.httpPort === data.ingress.httpsPort || "auth" in data.services)
			throw new Error("Invalid platform configuration: check ingress ports and reserved auth hostname");
	}
	const services: Record<string, GitFileSource> = {};
	for (const [serviceId, entry] of Object.entries(result.data.services)) {
		const descriptorPath = entry.descriptorPath ?? `${serviceId}.sd.yaml`;
		if (
			entry.remote === "local"
				? !descriptorPath.startsWith("/")
				: descriptorPath.startsWith("/") || descriptorPath.split("/").includes("..")
		)
			throw new Error(
				"Invalid platform configuration: descriptorPath must be absolute for local and repository-relative otherwise",
			);
		services[serviceId] = {
			...entry,
			descriptorPath,
			branch: entry.branch ?? (entry.remote === "local" ? undefined : "main"),
		};
	}
	if (result.data.reconciliation.maxRetryBackoffSeconds < result.data.reconciliation.retryBackoffSeconds)
		throw new Error("Invalid platform configuration: retry bounds");
	return { ...result.data, services };
}
