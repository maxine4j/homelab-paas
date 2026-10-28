import { expect, test } from "vitest";

import { DockerLogClient } from "./docker-log-client.ts";

const frame = (text: Uint8Array) => {
	const header = Buffer.alloc(8);
	header[0] = 1;
	header.writeUInt32BE(text.length, 4);
	return Buffer.concat([header, text]);
};

test("follows Docker logs with arbitrary partial frames and split Unicode", async () => {
	const bytes = frame(Buffer.from("hello 😀\n"));
	const calls: unknown[] = [];
	const client = new DockerLogClient({
		stream: async (path, signal) => {
			calls.push([path, signal]);
			return (async function* () {
				for (const byte of bytes) yield Uint8Array.of(byte);
			})();
		},
	});
	let content = "";
	const signal = new AbortController().signal;
	await client.follow(
		"container",
		(text) => {
			content += text;
		},
		signal,
	);
	expect(content).toBe("hello 😀\n");
	expect(calls).toEqual([
		["/containers/container/logs?stdout=true&stderr=true&timestamps=true&tail=200&follow=true", signal],
	]);
});

test("plain TTY, malformed/incomplete and oversized frames fail safely", async () => {
	for (const [bytes, expected] of [
		[Buffer.from("TTY 😀\n"), "TTY 😀\n"],
		[Buffer.from([1, 0, 0]), undefined],
		[Buffer.from([1, 0, 0, 0, 255, 255, 255, 255]), undefined],
	] as const) {
		const client = new DockerLogClient({
			stream: async () =>
				(async function* () {
					yield bytes;
				})(),
		});
		let text = "";
		const result = client.follow(
			"id",
			(value) => {
				text += value;
			},
			new AbortController().signal,
		);
		if (expected) {
			await result;
			expect(text).toBe(expected);
		} else await expect(result).rejects.toThrow("Docker operation failed");
	}
});
