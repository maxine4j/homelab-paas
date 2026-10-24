import { z } from "zod";

const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const positive = z.number().int().positive();
const name = z
	.string()
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
	.refine((name) => !name.startsWith("PAAS_"));
const environmentVariable = z.union([
	z.strictObject({ name, value: z.string().refine((value) => !value.includes("\0")) }),
	z.strictObject({ name, secret: z.literal(true) }),
]);
const absolutePath = z
	.string()
	.startsWith("/")
	.refine((path) => !path.includes("\0"));
const volume = z.strictObject({
	hostPath: absolutePath,
	mountPath: absolutePath.refine((path) => path !== "/"),
	readOnly: z.boolean().optional(),
});
const limits = z.strictObject({
	cpus: z
		.number()
		.min(1e-9)
		.max(Number.MAX_SAFE_INTEGER / 1e9)
		.optional(),
	memoryMiB: positive.max(Math.floor(Number.MAX_SAFE_INTEGER / 1048576)).optional(),
});
const base = {
	image: z.string().min(1),
	termination: z.strictObject({ timeoutSeconds: positive.max(300) }).optional(),
	limits: limits.optional(),
};
const workload = {
	...base,
	replicas: positive.default(1),
	rolloutStrategy: z.enum(["recreate", "surge"]).default("recreate"),
	command: z.array(z.string()).min(1).optional(),
	env: z
		.array(environmentVariable)
		.refine((env) => new Set(env.map(({ name }) => name)).size === env.length)
		.optional(),
	volumes: z
		.array(volume)
		.refine((volumes) => new Set(volumes.map(({ mountPath }) => mountPath)).size === volumes.length)
		.optional(),
	egress: z.array(id).optional(),
};
const web = z.strictObject({
	...workload,
	type: z.literal("web"),
	ingress: z.strictObject({ public: z.boolean().default(false), port: positive.max(65535) }),
	healthcheckUrl: z
		.string()
		.regex(/^\/(?!\/)[^\s]*$/)
		.default("/healthcheck"),
});
const worker = z.strictObject({ ...workload, type: z.literal("worker") });
const postgres = z.strictObject({ ...base, type: z.literal("postgres") });
const rabbitmq = z.strictObject({ ...base, type: z.literal("rabbitmq") });
const resource = z.discriminatedUnion("type", [web, worker, postgres, rabbitmq]);
export const serviceDescriptorSchema = z.strictObject({
	version: z.literal(1),
	metadata: z.strictObject({
		serviceId: id,
		description: z.string().optional(),
		labels: z.record(z.string(), z.string()).optional(),
	}),
	resources: z
		.record(id, resource)
		.refine((resources) => Object.values(resources).filter((resource) => resource.type === "web").length <= 1),
});

export type ServiceDescriptor = z.input<typeof serviceDescriptorSchema>;
export type Resource = z.input<typeof resource>;
export type WebResource = z.input<typeof web>;
export type WorkerResource = z.input<typeof worker>;
export type PostgresResource = z.input<typeof postgres>;
export type RabbitMqResource = z.input<typeof rabbitmq>;
export type EnvironmentVariable = z.input<typeof environmentVariable>;
export type ResourceVolume = z.input<typeof volume>;
export type ResourceLimits = z.input<typeof limits>;

/** Validates the full descriptor contract; schema failures retain their cause for diagnostics. */
export function parseDescriptor(value: unknown, serviceId: string): ServiceDescriptor {
	const result = serviceDescriptorSchema.safeParse(value);
	if (!result.success || result.data.metadata.serviceId !== serviceId)
		throw new Error("Invalid service descriptor: check service identity and resource configuration", {
			cause: result.success ? undefined : result.error,
		});
	return result.data;
}
