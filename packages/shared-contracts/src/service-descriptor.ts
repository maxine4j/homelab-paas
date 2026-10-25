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
	.refine((path) => !path.includes("\0") && !path.includes(":"));
const volume = z.strictObject({
	hostPath: absolutePath,
	mountPath: absolutePath.refine((path) => path !== "/"),
	readOnly: z.boolean().optional(),
});
const devicePath = absolutePath.refine(
	(path) =>
		path !== "/"
		&& path
			.slice(1)
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== ".."),
);
const device = z.strictObject({
	hostPath: devicePath,
	mountPath: devicePath,
	permissions: z
		.string()
		.regex(/^(?:r(?:w?m?)|wm?|m)$/)
		.default("rwm"),
});
const limits = z.strictObject({
	cpus: z
		.number()
		.min(1e-9)
		.max(Number.MAX_SAFE_INTEGER / 1e9)
		.optional(),
	memoryMiB: positive.max(Math.floor(Number.MAX_SAFE_INTEGER / 1048576)).optional(),
});
const hostPort = z.strictObject({
	protocol: z.enum(["tcp", "udp"]),
	containerPort: positive.max(65535),
	hostPort: positive.max(65535),
	bindAddress: z.union([z.ipv4(), z.ipv6()]).refine((address) => !address.includes("%")),
});

// URL canonicalization handles equivalent IPv6 spellings without a Node-only dependency.
const canonicalAddress = (address: string): string => {
	if (!address.includes(":")) return address;
	const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
	const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
	if (!mapped) return normalized;
	const high = Number.parseInt(mapped[1]!, 16);
	const low = Number.parseInt(mapped[2]!, 16);
	return [high >> 8, high & 255, low >> 8, low & 255].join(".");
};

const addressesOverlap = (left: string, right: string): boolean => {
	const a = canonicalAddress(left);
	const b = canonicalAddress(right);
	return (
		a === b
		|| a === "::"
		|| b === "::"
		|| (a === "0.0.0.0" && !b.includes(":"))
		|| (b === "0.0.0.0" && !a.includes(":"))
	);
};
const base = {
	image: z.string().min(1),
	termination: z.strictObject({ timeoutSeconds: positive.max(300) }).optional(),
	limits: limits.optional(),
};
const workload = {
	...base,
	devices: z
		.array(device)
		.refine((devices) => new Set(devices.map(({ mountPath }) => mountPath)).size === devices.length)
		.optional(),
	supplementaryGroups: z
		.array(z.number().int().min(0).max(4294967294))
		.refine((groups) => new Set(groups).size === groups.length)
		.optional(),
	hostPorts: z.array(hostPort).optional(),
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
	primary: z.boolean().optional(),
	ingress: z.strictObject({ public: z.boolean().default(false), port: positive.max(65535) }),
	healthcheckUrl: z
		.string()
		.regex(/^\/(?!\/)[^\s]*$/)
		.default("/healthcheck"),
});
const worker = z.strictObject({
	...workload,
	type: z.literal("worker"),
	healthcheckPort: positive.max(65535),
	healthcheckUrl: web.shape.healthcheckUrl,
});
const postgres = z.strictObject({ ...base, type: z.literal("postgres") });
const rabbitmq = z.strictObject({ ...base, type: z.literal("rabbitmq") });
const resource = z.discriminatedUnion("type", [web, worker, postgres, rabbitmq]);
export const serviceDescriptorSchema = z
	.strictObject({
		version: z.literal(1),
		metadata: z.strictObject({
			serviceId: id,
			description: z.string().optional(),
			labels: z.record(z.string(), z.string()).optional(),
		}),
		resources: z.record(id, resource).refine((resources) => {
			const webs = Object.values(resources).filter((resource) => resource.type === "web");
			return webs.length <= 1 || webs.filter((resource) => resource.primary === true).length === 1;
		}),
	})
	.superRefine((descriptor, context) => {
		const bindings: z.output<typeof hostPort>[] = [];
		for (const [resourceId, resource] of Object.entries(descriptor.resources)) {
			if (resource.type !== "web" && resource.type !== "worker") continue;
			if (resource.hostPorts?.length && (resource.replicas !== 1 || resource.rolloutStrategy !== "recreate")) {
				context.addIssue({
					code: "custom",
					path: ["resources", resourceId, "hostPorts"],
					message: "Host ports require one replica and recreate rollout",
				});
			}
			for (const binding of resource.hostPorts ?? []) {
				if (
					bindings.some(
						(other) =>
							other.protocol === binding.protocol
							&& other.hostPort === binding.hostPort
							&& addressesOverlap(other.bindAddress, binding.bindAddress),
					)
				) {
					context.addIssue({
						code: "custom",
						path: ["resources", resourceId, "hostPorts"],
						message: "Overlapping host port bindings",
					});
				}
				bindings.push(binding);
			}
		}
	});

export type ServiceDescriptor = z.input<typeof serviceDescriptorSchema>;
export type Resource = z.input<typeof resource>;
export type WebResource = z.input<typeof web>;
export type WorkerResource = z.input<typeof worker>;
export type PostgresResource = z.input<typeof postgres>;
export type RabbitMqResource = z.input<typeof rabbitmq>;
export type EnvironmentVariable = z.input<typeof environmentVariable>;
export type ResourceVolume = z.input<typeof volume>;
export type ResourceDevice = z.input<typeof device>;
export type ResourceLimits = z.input<typeof limits>;
export type ResourceHostPort = z.input<typeof hostPort>;

/** Validates the full descriptor contract; schema failures retain their cause for diagnostics. */
export function parseDescriptor(value: unknown, serviceId: string): ServiceDescriptor {
	const result = serviceDescriptorSchema.safeParse(value);
	if (!result.success || result.data.metadata.serviceId !== serviceId)
		throw new Error("Invalid service descriptor: check service identity and resource configuration", {
			cause: result.success ? undefined : result.error,
		});
	return result.data;
}
