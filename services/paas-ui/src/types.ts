export type ResourceTab = "config" | "state" | "logs";
export type Route =
	| { page: "services" }
	| { page: "cluster" }
	| { page: "missing" }
	| { page: "service"; serviceId: string }
	| { page: "events"; serviceId: string }
	| { page: "resource"; serviceId: string; resourceId: string; tab: ResourceTab; containerId?: string };
export interface ApiResult<T> {
	data?: T;
	error?: string;
}

export interface ServiceSourceDraft {
	privateKeyPath?: string;
	accessToken?: string;
	serviceId: string;
	remote: string;
	branch: string;
	descriptorPath: string;
}
