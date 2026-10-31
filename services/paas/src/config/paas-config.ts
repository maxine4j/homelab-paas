import type {
	JsonValue,
	ServiceDescriptor,
	UiConfigField,
	UiConfigUpdate,
	UiEditableConfig,
} from "@homelab-paas/shared-contracts";
import { parseDescriptor } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import type { IChangeBus } from "../events/change-bus.ts";
import type { GitFileSource } from "../git/types.ts";
import { createLogger } from "../util/logger.ts";
import { parseYaml } from "../util/yaml.ts";
import type { IConfigStore } from "./config-store.ts";
import { resolveImageTag } from "./image-tag-resolver.ts";
import { LogRedactor, type ILogRedactor } from "./log-redactor.ts";
import { redactSecrets } from "./secret-redaction.ts";
import type { ConfigDocument, PlatformConfig } from "./types.ts";

const environmentFields: Record<string, string> = {
	"auth.github.clientId": "GITHUB_CLIENT_ID",
	"auth.github.clientSecret": "GITHUB_CLIENT_SECRET",
	"auth.session.signingKey": "SESSION_SIGNING_KEY",
	"tls.dns.credentials.apiToken": "DIGITALOCEAN_API_TOKEN",
	"tls.acme.email": "ACME_EMAIL",
};
const secretFields = new Set(["auth.github.clientSecret", "auth.session.signingKey", "tls.dns.credentials.apiToken"]);

export interface IPaasConfig {
	createLogRedactor(additionalSecrets?: string[]): ILogRedactor;
	getClusterId(): string;
	getIngressConfig(): PlatformConfig["ingress"];
	getAuthConfig(): PlatformConfig["auth"];
	getTlsConfig(): PlatformConfig["tls"];
	getGitConfig(): PlatformConfig["git"];
	getGitEnvironment(): Readonly<Record<string, string | undefined>>;
	getReconciliationConfig(): PlatformConfig["reconciliation"];
	getServices(): PlatformConfig["services"];
	/** Independent public snapshot. Secret values are never included. */
	getEditableConfig(): UiEditableConfig;
	/** Validates, persists, then publishes. Throws ConfigEditError; omitted fields retain their disk values. */
	updateConfig(update: UiConfigUpdate): Promise<UiEditableConfig>;
	/** Redacts known platform secrets and additional caller-supplied secrets. */
	redact(value: string, additionalSecrets?: string[]): string;
	sanitize(value: unknown, additionalSecrets?: string[]): JsonValue;
}

export class ConfigEditError extends Error {
	constructor(
		public readonly kind: "invalid" | "conflict" | "unavailable",
		options?: ErrorOptions,
	) {
		super(
			kind === "invalid"
				? "Invalid configuration edit; check values and read-only fields"
				: kind === "conflict"
					? "Configuration changed; reload before saving"
					: "Cannot save configuration; check host file access and retry",
			options,
		);
	}
}

export class PaasConfig implements IPaasConfig {
	private readonly log = createLogger(PaasConfig.name);
	private current: PlatformConfig | undefined;
	private document: ConfigDocument | undefined;
	private pending: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly store: IConfigStore,
		private readonly environment: Readonly<Record<string, string | undefined>> = {},
		private readonly changes?: IChangeBus,
	) {}
	async load(): Promise<PlatformConfig> {
		return this.serial(async () => {
			const document = await this.store.read();
			const next = this.parseDocument(document.value);
			this.assertCompatible(next);
			const changed = this.document?.revision !== document.revision;
			this.current = next;
			this.document = document;
			if (changed) this.changes?.publish({});
			return structuredClone(next);
		});
	}

	getBuildRevision(): string {
		return this.environment["BUILD_SHA"] || "unknown";
	}

	/** Failed reloads retain the last validated configuration and report the cause. */
	async reload(): Promise<void> {
		try {
			await this.load();
		} catch (err) {
			this.log.error(
				{ err },
				"Cannot reload platform configuration; retaining previous configuration; check config.yaml and restart-required settings",
			);
		}
	}

	getClusterId(): string {
		return this.requireConfig().metadata.clusterId;
	}
	getIngressConfig(): PlatformConfig["ingress"] {
		return structuredClone(this.requireConfig().ingress);
	}
	getAuthConfig(): PlatformConfig["auth"] {
		return structuredClone(this.requireConfig().auth);
	}
	getTlsConfig(): PlatformConfig["tls"] {
		return structuredClone(this.requireConfig().tls);
	}
	getGitConfig(): PlatformConfig["git"] {
		return structuredClone(this.requireConfig().git);
	}
	getGitEnvironment(): Readonly<Record<string, string | undefined>> {
		return { ...this.environment };
	}
	getReconciliationConfig(): PlatformConfig["reconciliation"] {
		return structuredClone(this.requireConfig().reconciliation);
	}
	getServices(): PlatformConfig["services"] {
		return structuredClone(this.requireConfig().services);
	}
	getEditableConfig(): UiEditableConfig {
		const current = this.requireConfig();
		const fields: UiConfigField[] = [];
		const visit = (value: unknown, path: string): void => {
			if (value === undefined) return;
			if (path !== "services" && typeof value === "object" && value !== null && !Array.isArray(value)) {
				for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
				return;
			}
			const secret = secretFields.has(path);
			const managedByEnvironment = this.environment[environmentFields[path] ?? ""] !== undefined;
			const safe = this.sanitize(value);
			const comparable =
				path === "services"
					? Object.fromEntries(
							Object.entries(current.services).map(([id, source]) => [
								id,
								{ ...source, ...(source.accessToken ? { accessToken: "[redacted]" } : {}) },
							]),
						)
					: value;
			fields.push({
				path,
				kind: secret
					? "secret"
					: path === "services"
						? "json"
						: Array.isArray(value)
							? "list"
							: typeof value === "number"
								? "number"
								: "text",
				...(secret ? { configured: Boolean(value) } : { value: safe }),
				managedByEnvironment,
				readOnly:
					managedByEnvironment
					|| path === "version"
					|| path.startsWith("metadata.")
					|| path.startsWith("ingress.")
					|| (!secret && JSON.stringify(safe) !== JSON.stringify(comparable)),
			});
		};
		visit(current, "");
		return { config: this.sanitize(current), revision: this.document!.revision, fields };
	}

	async updateConfig(update: UiConfigUpdate): Promise<UiEditableConfig> {
		return this.serial(async () => {
			try {
				if (!update.changes.length || update.changes.length > 128) throw new ConfigEditError("invalid");
				const snapshot = this.getEditableConfig();
				const document = await this.store.read();
				if (update.revision !== snapshot.revision || document.revision !== snapshot.revision)
					throw new ConfigEditError("conflict");
				const candidate = structuredClone(document.value) as Record<string, unknown>;
				const seen = new Set<string>();
				for (const change of update.changes) {
					const field = snapshot.fields.find((entry) => entry.path === change.path);
					if (
						!field
						|| field.readOnly
						|| seen.has(change.path)
						|| (field.kind === "secret"
							&& (typeof change.value !== "string" || !change.value || change.value === "[redacted]"))
					)
						throw new ConfigEditError("invalid");
					seen.add(change.path);
					if (
						change.path === "services"
						&& change.value
						&& typeof change.value === "object"
						&& !Array.isArray(change.value)
					) {
						const services = structuredClone(change.value);
						for (const [id, source] of Object.entries(services)) {
							if (
								!source
								|| typeof source !== "object"
								|| Array.isArray(source)
								|| source["accessToken"] !== "[redacted]"
							)
								continue;
							const previous = this.requireConfig().services[id];
							if (!previous?.accessToken || source["remote"] !== previous.remote)
								throw new ConfigEditError("invalid");
							source["accessToken"] = previous.accessToken;
						}
						candidate["services"] = services;
						continue;
					}
					const parts = change.path.split(".");
					let parent = candidate;
					for (const key of parts.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
					parent[parts.at(-1)!] = structuredClone(change.value);
				}
				let next: PlatformConfig;
				try {
					next = this.parseDocument(candidate);
					this.assertCompatible(next);
				} catch (cause) {
					throw new ConfigEditError("invalid", { cause });
				}
				const saved = await this.store.write(candidate);
				this.document = saved;
				this.current = next;
				this.changes?.publish({});
				return this.getEditableConfig();
			} catch (cause) {
				if (cause instanceof ConfigEditError) throw cause;
				throw new ConfigEditError("unavailable", { cause });
			}
		});
	}

	redact(value: string, additionalSecrets: string[] = []): string {
		return redactSecrets(value, this.logSecrets(additionalSecrets));
	}

	createLogRedactor(additionalSecrets: string[] = []): ILogRedactor {
		return new LogRedactor(this.logSecrets(additionalSecrets));
	}

	private logSecrets(additionalSecrets: string[]): string[] {
		const current = this.requireConfig();
		const secrets = [
			current.auth?.github.clientSecret,
			current.auth?.session.signingKey,
			current.tls?.dns.credentials.apiToken,
			...Object.values(current.services).map((source) => source.accessToken),
			...additionalSecrets,
		]
			.filter((entry): entry is string => Boolean(entry))
			.sort((a, b) => b.length - a.length);
		return secrets;
	}

	sanitize(value: unknown, additionalSecrets: string[] = []): JsonValue {
		const visit = (entry: unknown, key = ""): JsonValue => {
			if (/secret|password|token|signingkey|command|credentials/i.test(key)) return "[redacted]";
			if (typeof entry === "string") return this.redact(entry, additionalSecrets);
			if (typeof entry === "number" || typeof entry === "boolean" || entry === null) return entry;
			if (Array.isArray(entry)) return entry.map((value) => visit(value));
			if (typeof entry === "object")
				return Object.fromEntries(
					Object.entries(entry)
						.filter(([, value]) => value !== undefined)
						.map(([key, value]) => [key, visit(value, key)]),
				);
			return null;
		};
		return visit(value);
	}

	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.pending.then(operation);
		this.pending = result.catch(() => {});
		return result;
	}

	private requireConfig(): PlatformConfig {
		if (!this.current) throw new Error("Platform configuration has not been loaded");
		return this.current;
	}

	private assertCompatible(next: PlatformConfig): void {
		if (
			this.current
			&& (next.metadata.clusterId !== this.current.metadata.clusterId
				|| JSON.stringify(next.ingress) !== JSON.stringify(this.current.ingress)
				|| Boolean(next.auth) !== Boolean(this.current.auth))
		)
			throw new Error("Platform identity, ingress and auth/TLS mode changes require a control-plane restart");
	}

	private parseDocument(raw: unknown): PlatformConfig {
		try {
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
				.parse(structuredClone(raw));
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

export function decodeDescriptorYaml(content: string, serviceId: string, revision?: string): ServiceDescriptor {
	try {
		const descriptor = parseDescriptor(parseYaml(content, `${serviceId}.sd.yaml`), serviceId);
		for (const resource of Object.values(descriptor.resources)) {
			resource.image = resolveImageTag(resource.image, revision);
		}
		return descriptor;
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
	privateKeyPath: z
		.string()
		.startsWith("/")
		// oxlint-disable-next-line no-control-regex -- Reject control characters in credential paths.
		.regex(/^[^\x00-\x1f\x7f]+$/)
		.optional(),
	accessToken: z
		.string()
		.min(1)
		// oxlint-disable-next-line no-control-regex -- Reject control characters in credentials.
		.regex(/^[^\x00-\x1f\x7f]+$/)
		.refine((value) => value !== "[redacted]")
		.optional(),
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
	git: z.strictObject({
		pollIntervalSeconds: positive.default(300),
		operationTimeoutSeconds: positive,
	}),
	reconciliation: z.strictObject({ retryBackoffSeconds: positive, maxRetryBackoffSeconds: positive }),
	services: z.record(id, source),
});
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
		const ssh =
			/^ssh:\/\//i.test(entry.remote)
			|| (/^(?:[^@/:\s]+@)?[^/:\s]+:.+/.test(entry.remote) && !entry.remote.includes("://"));
		if (
			(entry.privateKeyPath !== undefined && !ssh)
			|| (entry.accessToken !== undefined && !/^https:\/\//i.test(entry.remote))
		)
			throw new Error("Invalid platform configuration: privateKeyPath requires SSH; accessToken requires HTTPS");
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
