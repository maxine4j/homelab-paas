/** Envoy configuration values stay within the Envoy layers. */
export interface EnvoyResource {
	name: string;
	"@type": string;
	[key: string]: unknown;
}

export interface EnvoyConfiguration {
	clusters: EnvoyResource[];
	listeners: EnvoyResource[];
}

export class EnvoyClientError extends Error {
	constructor(options?: ErrorOptions) {
		super("Cannot publish or confirm Envoy configuration", options);
		this.name = "EnvoyClientError";
	}
}
