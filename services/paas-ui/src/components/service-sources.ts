import type { JsonValue } from "@homelab-paas/shared-contracts";

import type { ServiceSourceDraft } from "../types.ts";

export const repositoryProtocol = (remote: string): "https" | "ssh" | undefined => {
	if (/^https:\/\//i.test(remote.trim())) return "https";
	if (
		/^ssh:\/\//i.test(remote.trim())
		|| (/^(?:[^@/:\s]+@)?[^/:\s]+:.+/.test(remote.trim()) && !remote.includes("://"))
	)
		return "ssh";
	return undefined;
};

export const changeRepository = (source: ServiceSourceDraft, remote: string): ServiceSourceDraft => ({
	...source,
	remote,
	...(source.remote.trim() !== remote.trim() ? { accessToken: undefined, privateKeyPath: undefined } : {}),
});

export const readServiceSources = (value: JsonValue | undefined): ServiceSourceDraft[] => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.entries(value).map(([serviceId, source]) => {
		if (!source || typeof source !== "object" || Array.isArray(source))
			throw new Error("Invalid service source configuration");
		return {
			serviceId,
			remote: String(source["remote"] ?? ""),
			branch: String(source["branch"] ?? ""),
			descriptorPath: String(source["descriptorPath"] ?? ""),
			...(typeof source["accessToken"] === "string" ? { accessToken: source["accessToken"] } : {}),
			...(typeof source["privateKeyPath"] === "string" ? { privateKeyPath: source["privateKeyPath"] } : {}),
		};
	});
};

export const saveServiceSources = (rows: ServiceSourceDraft[]): JsonValue => {
	const sources: Record<string, JsonValue> = {};
	for (const row of rows) {
		const serviceId = row.serviceId.trim();
		const remote = row.remote.trim();
		const descriptorPath = row.descriptorPath.trim();
		const branch = row.branch.trim();
		if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(serviceId))
			throw new Error("Service IDs must use lowercase kebab case");
		if (Object.hasOwn(sources, serviceId)) throw new Error(`Duplicate service ID: ${serviceId}`);
		if (!remote) throw new Error(`Repository is required for ${serviceId}`);
		if (!descriptorPath) throw new Error(`Descriptor path is required for ${serviceId}`);
		if (remote === "local" && !descriptorPath.startsWith("/"))
			throw new Error(`Local descriptor path must be absolute for ${serviceId}`);
		sources[serviceId] = {
			remote,
			descriptorPath,
			...(branch ? { branch } : {}),
			...(repositoryProtocol(remote) === "https" && row.accessToken ? { accessToken: row.accessToken } : {}),
			...(repositoryProtocol(remote) === "ssh" && row.privateKeyPath?.trim()
				? { privateKeyPath: row.privateKeyPath.trim() }
				: {}),
		};
	}
	return sources;
};
