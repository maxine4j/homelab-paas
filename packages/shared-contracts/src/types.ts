export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface UiConfigField {
	path: string;
	kind: "text" | "number" | "list" | "json" | "secret";
	value?: JsonValue;
	configured?: boolean;
	readOnly: boolean;
	managedByEnvironment: boolean;
}

export interface UiEditableConfig {
	config: JsonValue;
	revision: string;
	fields: UiConfigField[];
}

export interface UiConfigUpdate {
	revision: string;
	changes: { path: string; value: JsonValue }[];
}

export interface UiCluster extends UiEditableConfig {
	clusterId: string;
}

export interface UiServiceSummary {
	serviceId: string;
	phase: "unknown" | "deploying" | "ready" | "failed";
	desiredRevision?: string;
	activeRevision?: string;
	activeRevisionMetadata?: UiRevisionMetadata;
	desiredRevisionMetadata?: UiRevisionMetadata;
	failures?: number;
	retryAt?: number;
}

export interface UiServiceEvent {
	timestamp: number;
	level: "info" | "error";
	event:
		| "reconciliation.failed"
		| "reconciliation.state-failed"
		| "reconciliation.recovered"
		| "deployment.succeeded";
	message: string;
	resourceId?: string;
	revision?: string;
	failures?: number;
	retryAt?: number;
	secretFailure?: UiSecretFailure;
}

export interface UiSecretFailure {
	reason: "missing-file" | "unreadable-file" | "invalid-file" | "missing-variables";
	/** Path read inside the control-plane container. */
	filePath: string;
	/** Actual Docker host path, only when a bind mount mapping is known. */
	hostFilePath?: string;
	missingVariables?: string[];
	line?: number;
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

export interface UiRevisionMetadata {
	authorName: string;
	authoredAt: string;
	message: string;
}

export interface UiService extends UiServiceSummary {
	source: JsonValue;
	descriptorRevision?: string;
	descriptorRevisionMetadata?: UiRevisionMetadata;
	descriptorStatus: "available" | "unavailable";
	/** Complete parsed descriptor with literal environment values visible; credentials and commands redacted. */
	descriptor?: JsonValue;
	resources: UiResource[];
}

export interface UiLogs {
	containerId: string;
	content: string;
	tail: 200;
}
