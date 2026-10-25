export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface UiCluster {
	clusterId: string;
	config: JsonValue;
}

export interface UiServiceSummary {
	serviceId: string;
	phase: "unknown" | "deploying" | "ready" | "failed";
	desiredRevision?: string;
	activeRevision?: string;
	failures?: number;
	retryAt?: number;
}

export interface UiContainer {
	id: string;
	resourceId: string;
	imageId: string;
	state: string;
	revision: string;
	running?: boolean;
	networks?: Record<string, { address: string; aliases: string[] }>;
}

export interface UiResource {
	resourceId: string;
	type: string;
	/** Desired web ingress URLs; presence does not imply readiness. */
	url?: string;
	primaryUrl?: string;
	config?: JsonValue;
	containers: UiContainer[];
}

export interface UiService extends UiServiceSummary {
	source: JsonValue;
	descriptorRevision?: string;
	descriptorStatus: "available" | "unavailable";
	resources: UiResource[];
}

export interface UiLogs {
	containerId: string;
	content: string;
	tail: 200;
}
