import { expect, test } from "vitest";

import { ingressPorts } from "./ports.ts";

test("selects distinct ingress ports even when released ports are immediately reused", async () => {
	const held = new Set<number>();
	const reserve = async () => {
		const port = held.has(43759) ? 43760 : 43759;
		held.add(port);
		return {
			port,
			release: async () => {
				held.delete(port);
			},
		};
	};
	expect(await ingressPorts(reserve)).toEqual([43759, 43760]);
	expect(held.size).toBe(0);
});

test("releases the HTTP reservation if HTTPS allocation fails", async () => {
	let held = false;
	const failure = new Error("Cannot listen");
	const reserve = async () => {
		if (held) throw failure;
		held = true;
		return {
			port: 43759,
			release: async () => {
				held = false;
			},
		};
	};
	await expect(ingressPorts(reserve)).rejects.toBe(failure);
	expect(held).toBe(false);
});
