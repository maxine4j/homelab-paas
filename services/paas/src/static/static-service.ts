import type { IPaasConfig } from "../config/paas-config.ts";
import type { FrontendResult } from "../frontend/frontend-service.ts";
import type { IEndpointsStore } from "../reconciler/networking/endpoints-store.ts";
import type { IStaticStore } from "./static-store.ts";

export interface IStaticService {
	/** Resolves a published static hostname and decoded file path; no SPA or management fallback. */
	resolve(host: string, path: string): Promise<FrontendResult>;
}

export class StaticService implements IStaticService {
	constructor(
		private readonly config: IPaasConfig,
		private readonly endpoints: { getAll: IEndpointsStore["getAll"] },
		private readonly store: { read: IStaticStore["read"] },
	) {}
	async resolve(host: string, path: string): Promise<FrontendResult> {
		if (
			!path.startsWith("/")
			|| path.startsWith("//")
			|| /[\0\\]/.test(path)
			|| path.split("/").some((part) => part === "." || part === "..")
		)
			return { kind: "missing" };
		const hostname = host.toLowerCase().replace(/:[0-9]+$/, "");
		const suffix = `.${this.config.getIngressConfig().baseDomain}`;
		if (!hostname.endsWith(suffix)) return { kind: "missing" };
		const id = hostname.slice(0, -suffix.length);
		const endpoints = await this.endpoints.getAll();
		const entry = Object.entries(endpoints).find(
			([key, value]) => value.static && (key === id || (value.primary && key.split(".").at(1) === id)),
		);
		if (!entry) return { kind: "missing" };
		const [resourceId, serviceId] = entry[0].split(".");
		if (!resourceId || !serviceId) return { kind: "missing" };
		const file = `${path.slice(1)}${path.endsWith("/") ? "index.html" : ""}`;
		const content = await this.store.read(serviceId, resourceId, file);
		return content ? { kind: "file", path: file, content } : { kind: "missing" };
	}
}
