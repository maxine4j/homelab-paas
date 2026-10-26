export { parseDescriptor, serviceDescriptorSchema } from "./service-descriptor.ts";
export type {
	ServiceDescriptor,
	Resource,
	WebResource,
	WorkerResource,
	PostgresResource,
	RabbitMqResource,
	EnvironmentVariable,
	ResourceVolume,
	ResourceDevice,
	ResourceLimits,
	ResourceHostPort,
} from "./service-descriptor.ts";
export type {
	JsonValue,
	UiCluster,
	UiServiceSummary,
	UiServiceEvent,
	UiSecretFailure,
	UiContainer,
	UiResource,
	UiService,
	UiRevisionMetadata,
	UiLogs,
	UiEditableConfig,
	UiConfigField,
	UiConfigUpdate,
} from "./types.ts";
