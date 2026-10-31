export type ResourceTab = "config" | "logs";
export type ServiceTab = "overview" | "resources" | "descriptor";
export type Route =
	| { page: "services" }
	| { page: "cluster" }
	| { page: "missing" }
	| { page: "service"; serviceId: string; tab?: ServiceTab }
	| { page: "events"; serviceId: string }
	| { page: "secrets"; serviceId: string }
	| { page: "resource-events"; serviceId: string; resourceId: string }
	| { page: "resource"; serviceId: string; resourceId: string; tab: ResourceTab; containerId?: string };
export interface ApiResult<T> {
	connected?: boolean;
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
export interface GitRefreshState {
	pending: boolean;
	message?: string;
	error?: string;
}
