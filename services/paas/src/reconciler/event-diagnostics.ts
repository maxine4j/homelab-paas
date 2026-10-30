import type { IPaasConfig } from "../config/paas-config.ts";
import { EnvironmentResolutionError } from "./environment-resolver.ts";

export interface IEventDiagnostics {
	describe(failure: unknown, context: Record<string, unknown>, secrets: string[]): string;
}

export class EventDiagnostics implements IEventDiagnostics {
	constructor(private readonly config: IPaasConfig) {}
	describe(failure: unknown, context: Record<string, unknown>, secrets: string[]): string {
		const budget = { nodes: 128, seen: new WeakSet<object>() };
		const text = JSON.stringify(
			{
				error: this.visit(failure, secrets, budget, 0),
				context: this.visit(context, secrets, budget, 0),
			},
			undefined,
			2,
		);
		if (Buffer.byteLength(JSON.stringify(text)) <= 32768) return text;
		let start = 0;
		let end = text.length;
		while (start < end) {
			const middle = Math.ceil((start + end) / 2);
			if (Buffer.byteLength(JSON.stringify(`${text.slice(0, middle)}\n[truncated]`)) <= 32768) start = middle;
			else end = middle - 1;
		}
		return `${text.slice(0, start)}\n[truncated]`;
	}

	private visit(
		value: unknown,
		secrets: string[],
		budget: { nodes: number; seen: WeakSet<object> },
		depth: number,
	): unknown {
		if (typeof value === "string") {
			const safe = this.config
				.redact(value, secrets)
				.replace(/Command failed:[^\r\n]*/g, "Command failed: [redacted]");
			return safe.length <= 16384 ? safe : `${safe.slice(0, 16384)}\n[truncated]`;
		}
		if (value === null || typeof value === "number" || typeof value === "boolean") return value;
		if (typeof value !== "object") return String(value);
		if (budget.seen.has(value)) return "[circular]";
		if (depth >= 8 || budget.nodes-- <= 0) return "[truncated]";
		budget.seen.add(value);
		if (Array.isArray(value)) {
			const entries = value.slice(0, 32).map((entry) => this.visit(entry, secrets, budget, depth + 1));
			return value.length > 32 ? [...entries, "[truncated]"] : entries;
		}
		const properties = Object.getOwnPropertyDescriptors(value);
		const keys =
			value instanceof Error
				? [
						...new Set([
							"name",
							"message",
							"cause",
							"errors",
							...Object.keys(properties).filter((key) => key !== "stack"),
							"stack",
						]),
					]
				: Object.keys(properties);
		const result: Record<string, unknown> = {};
		for (const key of keys.slice(0, 32)) {
			const safeKey = this.config.redact(key, secrets).slice(0, 256);
			if (
				/secret|password|token|signingkey|command|credentials|authorization|cookie|(?:api|private)[_-]?key|^(?:env|cmd|args|argv)$/i.test(
					key,
				)
			) {
				result[safeKey] = "[redacted]";
				continue;
			}
			if (key === "cause" && value instanceof EnvironmentResolutionError) {
				result[safeKey] = "Secret-file contents omitted; see structured secret diagnostics";
				continue;
			}
			const property = properties[key];
			if (property && "value" in property)
				result[safeKey] = this.visit(property.value, secrets, budget, depth + 1);
			else if (key === "name" && value instanceof Error)
				result[safeKey] = this.visit(value.name, secrets, budget, depth + 1);
			else if (key === "stack" && value instanceof Error)
				result[safeKey] = this.visit(value.stack, secrets, budget, depth + 1);
		}
		if (keys.length > 32) result["omitted"] = "[truncated]";
		return result;
	}
}
