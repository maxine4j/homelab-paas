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
	ResourceLimits,
	ResourceHostPort,
} from "./service-descriptor.ts";
export type { JsonValue, UiCluster, UiServiceSummary, UiContainer, UiResource, UiService, UiLogs } from "./types.ts";
