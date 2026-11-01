import type { ServiceDescriptor, StaticResource, WebResource } from "@homelab-paas/shared-contracts";

import type { Endpoint } from "./types.ts";

export interface IResourceRoutingPolicy {
	/** Uses validated raw resources, without capability validation or secret resolution. */
	primaryResource(resources: ServiceDescriptor["resources"]): string | undefined;
	/** Projects an effective resource/address without I/O. Callers establish readiness before publication. */
	webEndpoint(resource: WebResource, address: string): Endpoint;
	/** Targets the control-plane static listener; callers publish the bundle first. */
	staticEndpoint(resource: StaticResource): Endpoint;
	/** Compares all route semantics, normalizing optional persisted defaults. */
	matches(expected: Endpoint, actual: Endpoint | undefined): boolean;
}

export class ResourceRoutingPolicy implements IResourceRoutingPolicy {
	primaryResource(resources: ServiceDescriptor["resources"]): string | undefined {
		const routable = Object.entries(resources).flatMap(([id, resource]) =>
			resource.type === "web" || resource.type === "static" ? [{ id, primary: resource.primary }] : [],
		);
		return (routable.length === 1 ? routable.at(0) : routable.find((resource) => resource.primary === true))?.id;
	}

	webEndpoint(resource: WebResource, address: string): Endpoint {
		return {
			address,
			port: resource.ingress.port,
			healthcheckPath: resource.healthcheckUrl ?? undefined,
			public: resource.ingress.public ?? false,
			primary: resource.primary ?? true,
		};
	}

	staticEndpoint(resource: StaticResource): Endpoint {
		return {
			address: "127.0.0.1",
			port: 8081,
			static: true,
			public: resource.ingress?.public ?? false,
			primary: resource.primary ?? false,
		};
	}

	matches(expected: Endpoint, actual: Endpoint | undefined): boolean {
		return (
			actual !== undefined
			&& expected.address === actual.address
			&& expected.port === actual.port
			&& expected.public === actual.public
			&& (expected.primary ?? true) === (actual.primary ?? true)
			&& (expected.static ?? false) === (actual.static ?? false)
			&& (expected.healthcheckPath ?? undefined) === (actual.healthcheckPath ?? undefined)
		);
	}
}
