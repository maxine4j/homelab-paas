import { z } from "zod";

import type { IDockerLogTransport } from "./docker-transport.ts";
import type { DockerEvent } from "./types.ts";

export interface IDockerEventClient {
	/** Resolves after headers establish the single stream. Cancellation closes headers/body.
	 * Rejects with safe errors on connection, framing or validation failure. No replay guarantee.
	 */
	subscribe(signal: AbortSignal): Promise<AsyncIterable<DockerEvent>>;
}

export class DockerEventClient implements IDockerEventClient {
	constructor(private readonly transport: IDockerLogTransport) {}

	async subscribe(signal: AbortSignal): Promise<AsyncIterable<DockerEvent>> {
		try {
			const filters = encodeURIComponent(JSON.stringify({ type: ["container", "network"] }));
			return this.decode(await this.transport.stream(`/events?filters=${filters}`, signal));
		} catch (cause) {
			throw new Error("Cannot subscribe to Docker events", { cause });
		}
	}

	private async *decode(stream: AsyncIterable<Uint8Array>): AsyncIterable<DockerEvent> {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let pending = "";
		try {
			for await (const chunk of stream) {
				pending += decoder.decode(chunk, { stream: true });
				let newline: number;
				while ((newline = pending.indexOf("\n")) >= 0) {
					if (newline > 262144) throw new Error();
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					if (!line.trim()) continue;
					const event = eventSchema.parse(JSON.parse(line));
					if (!this.relevant(event.Type, event.Action)) continue;
					yield {
						type: event.Type,
						action: event.Action,
						id: event.Actor.ID,
						attributes: event.Actor.Attributes,
					};
				}
				if (pending.length > 262144) throw new Error();
			}
			pending += decoder.decode();
			if (pending.trim()) throw new Error();
		} catch {
			// Raw event attributes may include sensitive workload metadata. Never retain them in failures.
			throw new Error("Invalid Docker event stream");
		}
	}

	private relevant(type: string, action: string): boolean {
		return type === "network"
			? ["create", "destroy", "connect", "disconnect"].includes(action)
			: [
					"create",
					"start",
					"stop",
					"die",
					"destroy",
					"kill",
					"restart",
					"pause",
					"unpause",
					"update",
					"rename",
					"oom",
				].includes(action) || action.startsWith("health_status:");
	}
}

const eventSchema = z.object({
	Type: z.enum(["container", "network"]),
	Action: z.string(),
	Actor: z.object({ ID: z.string().min(1), Attributes: z.record(z.string(), z.string()).default({}) }),
});
