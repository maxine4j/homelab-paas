import type { HealthStatus, UiHealthPeriod, UiServiceEvent } from "@homelab-paas/shared-contracts";

export interface HealthTimelineMarker {
	timestamp: number;
	health: HealthStatus;
	event?: UiServiceEvent;
	period?: UiHealthPeriod;
}

export interface HealthTimelineCluster {
	left: number;
	width: number;
	markers: HealthTimelineMarker[];
	runs: HealthTimelineMarker[][];
}

export type ResourceTab = "config" | "descriptor" | "logs";
export type ServiceTab = "overview" | "resources" | "descriptor";
export type Route =
	| { page: "services" }
	| { page: "cluster"; tab?: "config" | "logs" | "ingress-logs" }
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
