export interface StaticIdentity {
	serviceId: string;
	resourceId: string;
	revision: string;
	path: string;
}

export type StaticSnapshot = "current" | "missing" | "different";
