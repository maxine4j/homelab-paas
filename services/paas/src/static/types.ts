export interface StaticIdentity {
	serviceId: string;
	resourceId: string;
	revision: string;
	path: string;
}

export type StaticSnapshot = "current" | "missing" | "different";

export interface StaticPublicationOptions {
	/** Replaces files even when the existing bytes match the freshly exported bundle. */
	force?: boolean;
}
