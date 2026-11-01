import { createHash } from "node:crypto";

import type { ServiceDescriptor, WebResource, WorkerResource } from "@homelab-paas/shared-contracts";

import type { IPaasConfig } from "../config/paas-config.ts";
import type { IGitService } from "../git/git-service.ts";
import type { IEnvironmentResolver } from "./environment-resolver.ts";
import type { DescriptorDecoder, DesiredService } from "./types.ts";

export interface IDesiredInputs {
	/** Cached validated inputs for deployment/audit. Resolved secrets remain internal. Failures never return stale success. */
	read(serviceId: string): Promise<DesiredService>;
	/** Re-observes committed inputs/secrets. Returns true only when accepted desired identity changed.
	 * Throws DesiredInputError on invalid/unavailable inputs; cached success is discarded.
	 */
	refresh(serviceId: string): Promise<boolean>;
	/** Drops successful cached resolution; the next read must validate inputs again. */
	invalidate(serviceId: string): void;
}

export class DesiredInputError extends Error {
	constructor(
		readonly stage: "fetch" | "descriptor" | "capabilities" | "secrets",
		readonly revision: string | undefined,
		readonly resourceId: string | undefined,
		options: ErrorOptions,
	) {
		super("Cannot prepare desired service inputs", options);
	}
}

export class DesiredInputs implements IDesiredInputs {
	private readonly cache = new Map<string, { namespace: string; identity: string; value: DesiredService }>();
	private readonly descriptors = new Map<
		string,
		{ identity: string; resources: [string, WebResource | WorkerResource][] }
	>();
	private readonly generations = new Map<string, number>();
	private readonly pending = new Map<string, Promise<DesiredService>>();

	constructor(
		private readonly config: IPaasConfig,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly environment: IEnvironmentResolver,
	) {}

	async read(serviceId: string): Promise<DesiredService> {
		const pending = this.pending.get(serviceId);
		if (pending) return structuredClone(await pending);
		const cached = this.cache.get(serviceId);
		if (cached?.namespace === this.namespace(serviceId)) return structuredClone(cached.value);
		return structuredClone(await this.load(serviceId));
	}

	async refresh(serviceId: string): Promise<boolean> {
		const previous = this.cache.get(serviceId)?.identity;
		this.invalidate(serviceId);
		await this.load(serviceId);
		return previous !== this.cache.get(serviceId)?.identity;
	}

	invalidate(serviceId: string): void {
		this.generations.set(serviceId, (this.generations.get(serviceId) ?? 0) + 1);
		this.cache.delete(serviceId);
		this.pending.delete(serviceId);
	}

	private async load(serviceId: string): Promise<DesiredService> {
		const generation = this.generations.get(serviceId) ?? 0;
		const namespace = this.namespace(serviceId);
		const operation = this.resolve(serviceId, namespace).then((value) => {
			if ((this.generations.get(serviceId) ?? 0) !== generation || this.namespace(serviceId) !== namespace) {
				if (this.pending.get(serviceId) === operation) this.pending.delete(serviceId);
				return this.read(serviceId);
			}
			this.cache.set(serviceId, { namespace, identity: this.hash([namespace, value]), value });
			return value;
		});
		this.pending.set(serviceId, operation);
		try {
			return await operation;
		} finally {
			if (this.pending.get(serviceId) === operation) this.pending.delete(serviceId);
		}
	}

	private async resolve(serviceId: string, namespace: string): Promise<DesiredService> {
		let stage: DesiredInputError["stage"] = "fetch";
		let revision: string | undefined;
		let resourceId: string | undefined;
		try {
			const source = this.config.getServices()[serviceId];
			if (!source) throw new Error("Service is not configured");
			const file = await this.git.fetchFile(serviceId, source);
			revision = file.revision;
			const identity = this.hash([namespace, file]);
			let desired = this.descriptors.get(serviceId);
			if (desired?.identity !== identity) {
				stage = "descriptor";
				const descriptor = this.decode(file.content, serviceId, file.revision);
				stage = "capabilities";
				desired = { identity, resources: this.resources(descriptor) };
				this.descriptors.set(serviceId, desired);
			}
			stage = "secrets";
			resourceId = desired.resources.length === 1 ? desired.resources.at(0)?.[0] : undefined;
			const declared = new Map(
				desired.resources.flatMap(([, resource]) =>
					(resource.env ?? [])
						.filter((entry) => "secret" in entry)
						.map((entry) => [entry.name, entry] as const),
				),
			);
			const resolved = new Map(
				(await this.environment.resolve(serviceId, [...declared.values()])).map((entry) => [
					entry.name,
					entry.value,
				]),
			);
			return {
				revision,
				secrets: [...resolved.values()],
				resources: desired.resources.map(([id, resource]) => [
					id,
					{
						...resource,
						env: (resource.env ?? []).map((entry) => {
							const value = "value" in entry ? entry.value : resolved.get(entry.name);
							if (value === undefined)
								throw new Error("Cannot resolve application secrets; open the service Secrets tab");
							return { name: entry.name, value };
						}),
					},
				]),
			};
		} catch (cause) {
			throw new DesiredInputError(stage, revision, resourceId, { cause });
		}
	}

	private resources(descriptor: ServiceDescriptor): [string, WebResource | WorkerResource][] {
		const entries = Object.entries(descriptor.resources);
		const webCount = entries.filter(([, resource]) => resource.type === "web").length;
		if (!entries.length) throw new Error("Runtime requires at least one workload resource");
		return entries.map(([id, resource]) => {
			if (
				(resource.type !== "web" && resource.type !== "worker")
				|| (resource.type === "web"
					&& ((!this.config.getAuthConfig() && resource.ingress.public !== true)
						|| (resource.replicas ?? 1) !== 1))
				|| resource.egress !== undefined
			)
				throw new Error("Resource requires unsupported runtime capabilities");
			return [
				id,
				resource.type === "web"
					? { ...resource, primary: webCount === 1 || resource.primary === true }
					: resource,
			];
		});
	}

	private namespace(serviceId: string): string {
		return this.hash([
			this.config.getServices()[serviceId],
			this.config.getIngressConfig(),
			this.config.getAuthConfig(),
			this.config.getTlsConfig(),
		]);
	}

	private hash(value: unknown): string {
		return createHash("sha256").update(JSON.stringify(value)).digest("hex");
	}
}
