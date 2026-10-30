import { z } from "zod";

import type { UiLiveTarget } from "./types.ts";

const identity = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(63);
const containerId = z
	.string()
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
	.max(256);
const subscriptionId = z
	.string()
	.regex(/^[a-zA-Z0-9-]+$/)
	.max(64);
export const uiLiveTargetSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("cluster") }),
	z.strictObject({ kind: z.literal("services") }),
	z.strictObject({ kind: z.literal("service"), serviceId: identity }),
	z.strictObject({ kind: z.literal("events"), serviceId: identity }),
	z.strictObject({ kind: z.literal("resource"), serviceId: identity, resourceId: identity }),
	z.strictObject({ kind: z.literal("logs"), serviceId: identity, resourceId: identity, containerId }),
]);
export const uiLiveClientSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("subscribe"), id: subscriptionId, target: uiLiveTargetSchema }),
	z.strictObject({ type: z.literal("unsubscribe"), id: subscriptionId }),
]);
const metadata = z.object({ authorName: z.string(), authoredAt: z.string(), message: z.string() });
const summary = z.object({
	serviceId: identity,
	phase: z.enum(["unknown", "deploying", "ready", "failed"]),
	description: z.string().optional(),
	primaryUrl: z.string().optional(),
	desiredRevision: z.string().optional(),
	activeRevision: z.string().optional(),
	activeRevisionMetadata: metadata.optional(),
	desiredRevisionMetadata: metadata.optional(),
	failures: z.number().optional(),
	retryAt: z.number().optional(),
});
const resource = z.object({
	resourceId: identity,
	health: z.enum(["deploying", "missing", "healthy", "unhealthy"]),
	type: z.string(),
	url: z.string().optional(),
	primaryUrl: z.string().optional(),
	config: z.json().optional(),
	configYaml: z.string().optional(),
	containers: z.array(
		z.object({
			id: z.string(),
			resourceId: identity,
			imageId: z.string(),
			state: z.string(),
			revision: z.string(),
			running: z.boolean().optional(),
			networks: z.record(z.string(), z.object({ address: z.string(), aliases: z.array(z.string()) })).optional(),
		}),
	),
});
export const uiServiceEventSchema = z.object({
	timestamp: z.number().finite().nonnegative(),
	level: z.enum(["info", "error"]),
	event: z.enum([
		"deployment.started",
		"deployment.succeeded",
		"reconciliation.failed",
		"reconciliation.state-failed",
		"reconciliation.recovered",
	]),
	message: z.string().max(4096),
	diagnostics: z
		.string()
		.max(32768)
		.refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 32768)
		.optional(),
	resourceId: identity.optional(),
	revision: z.string().optional(),
	failures: z.number().optional(),
	retryAt: z.number().optional(),
	secretFailure: z
		.object({
			reason: z.enum(["missing-file", "unreadable-file", "invalid-file", "missing-variables"]),
			filePath: z.string(),
			hostFilePath: z.string().optional(),
			missingVariables: z.array(z.string()).optional(),
			line: z.number().optional(),
		})
		.optional(),
});
const cluster = z.object({
	clusterId: z.string(),
	config: z.json(),
	revision: z.string(),
	fields: z.array(
		z.object({
			path: z.string(),
			kind: z.enum(["text", "number", "list", "json", "secret"]),
			value: z.json().optional(),
			configured: z.boolean().optional(),
			readOnly: z.boolean(),
			managedByEnvironment: z.boolean(),
		}),
	),
});
const service = summary.extend({
	source: z.json(),
	descriptorRevision: z.string().optional(),
	descriptorRevisionMetadata: metadata.optional(),
	descriptorStatus: z.enum(["available", "unavailable"]),
	descriptor: z.json().optional(),
	descriptorYaml: z.string().optional(),
	resources: z.array(resource),
});
const snapshot = z
	.strictObject({ type: z.literal("snapshot"), id: subscriptionId, target: uiLiveTargetSchema, data: z.json() })
	.superRefine((value, context) => {
		const schema = {
			cluster,
			services: z.array(summary),
			service,
			events: z.array(uiServiceEventSchema).max(200),
			resource,
			logs: z.object({ containerId: z.string(), content: z.string().max(131072), tail: z.literal(200) }),
		}[value.target.kind];
		if (!schema.safeParse(value.data).success) context.addIssue({ code: "custom", message: "Invalid snapshot" });
	});
export const uiLiveServerSchema = z.union([
	snapshot,
	z.strictObject({
		type: z.literal("error"),
		id: subscriptionId,
		message: z.enum(["Requested item was not found", "Cluster data is unavailable; retry shortly"]),
	}),
	z.strictObject({ type: z.literal("event"), serviceId: identity, event: uiServiceEventSchema }),
]);

/** URL adaptation shared by browser subscriptions; domain services receive typed targets. */
export const uiLiveTargetFromPath = (path: string): UiLiveTarget | undefined => {
	const parts = path
		.split("/")
		.slice(1)
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return "";
			}
		});
	const [root, serviceId, section, resourceId, containers, id, logs] = parts;
	let target: unknown;
	if (path === "/cluster") target = { kind: "cluster" };
	else if (path === "/services") target = { kind: "services" };
	else if (root === "services" && parts.length === 2) target = { kind: "service", serviceId };
	else if (root === "services" && section === "events" && parts.length === 3) target = { kind: "events", serviceId };
	else if (root === "services" && section === "resources" && parts.length === 4)
		target = { kind: "resource", serviceId, resourceId };
	else if (
		root === "services"
		&& section === "resources"
		&& containers === "containers"
		&& logs === "logs"
		&& parts.length === 7
	)
		target = { kind: "logs", serviceId, resourceId, containerId: id };
	return uiLiveTargetSchema.safeParse(target).data;
};
