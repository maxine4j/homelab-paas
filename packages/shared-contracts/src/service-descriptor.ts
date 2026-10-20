import { z } from "zod";

/** Public service descriptor contract. The MVP supports one public web resource. */
export interface ServiceDescriptor {
	version: 1;
	metadata: { serviceId: string; description?: string; labels?: Record<string, string> };
	resources: Record<string, WebResource>;
}

export interface WebResource {
	type: "web";
	image: string;
	replicas?: 1;
	rolloutStrategy?: "recreate" | "surge";
	ingress: { public: true; port: number };
	healthcheckUrl?: string;
	command?: string[];
	env?: { name: string; value: string }[];
	termination?: { timeoutSeconds: number };
}

const id = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const positive = z.number().int().positive();
const web = z.strictObject({
	type: z.literal("web"),
	image: z.string().min(1),
	replicas: z.literal(1).default(1),
	rolloutStrategy: z.literal("recreate").default("recreate"),
	ingress: z.strictObject({ public: z.literal(true), port: positive.max(65535) }),
	healthcheckUrl: z
		.string()
		.regex(/^\/(?!\/)[^\s]*$/)
		.default("/healthcheck"),
	command: z.array(z.string()).min(1).optional(),
	env: z
		.array(
			z.strictObject({
				name: z
					.string()
					.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
					.refine((name) => !name.startsWith("PAAS_")),
				value: z.string(),
			}),
		)
		.optional(),
	termination: z.strictObject({ timeoutSeconds: positive.max(300) }).optional(),
});
const descriptor = z.strictObject({
	version: z.literal(1),
	metadata: z.strictObject({
		serviceId: id,
		description: z.string().optional(),
		labels: z.record(z.string(), z.string()).optional(),
	}),
	resources: z.record(id, web).refine((resources) => Object.keys(resources).length === 1),
});

/** Rejects unsupported features before any Docker changes; never includes input values in errors. */
export function parseDescriptor(value: unknown, serviceId: string): ServiceDescriptor {
	const result = descriptor.safeParse(value);
	if (!result.success || result.data.metadata.serviceId !== serviceId)
		throw new Error(
			"Invalid service descriptor: expected one public web resource matching the configured service ID",
		);
	return result.data;
}
