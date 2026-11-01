import { describe, expect, it } from "vitest";

import { DockerEventClient } from "./docker-event-client.ts";

describe("DockerEventClient", () => {
	it("frames split UTF-8/JSON lines and drops exec noise before returning domain hints", async () => {
		let path = "";
		const bytes = Buffer.from(
			[
				JSON.stringify({ Type: "container", Action: "exec_start", Actor: { ID: "noise", Attributes: {} } }),
				JSON.stringify({ Type: "container", Action: "die", Actor: { ID: "id", Attributes: { name: "é" } } }),
			].join("\n") + "\n",
		);
		const client = new DockerEventClient({
			stream: async (value) => {
				path = value;
				return (async function* () {
					for (const byte of bytes) yield Uint8Array.of(byte);
				})();
			},
		});
		const stream = await client.subscribe(new AbortController().signal);
		const events = [];
		for await (const event of stream) events.push(event);
		expect(path).toContain("/events?");
		expect(events).toEqual([{ type: "container", action: "die", id: "id", attributes: { name: "é" } }]);
	});

	it("rejects malformed, oversized and incomplete frames without retaining raw payloads", async () => {
		for (const body of ["secret-value\n", "x".repeat(262145), '{"Type":']) {
			const client = new DockerEventClient({
				stream: async () =>
					(async function* () {
						yield Buffer.from(body);
					})(),
			});
			const read = async () => {
				for await (const _event of await client.subscribe(new AbortController().signal)) {
					/* consume */
				}
			};
			await expect(read()).rejects.toThrow("Invalid Docker event stream");
		}
	});

	it("passes cancellation to the shared transport and sanitizes connection failures", async () => {
		const controller = new AbortController();
		const client = new DockerEventClient({
			stream: async (_path, signal) => {
				expect(signal).toBe(controller.signal);
				throw new Error("secret payload");
			},
		});
		await expect(client.subscribe(controller.signal)).rejects.toThrow("Cannot subscribe to Docker events");
	});
});
