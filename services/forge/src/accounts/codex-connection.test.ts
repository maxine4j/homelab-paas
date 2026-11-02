import { sleep } from "@homelab-paas/backend-infrastructure/sleep";
import { describe, expect, it, vi } from "vitest";

import type { IAccountProcess } from "./account-process.ts";
import { CodexConnection } from "./codex-connection.ts";
import type { AccountProcessSpec } from "./types.ts";

describe("CodexConnection", () => {
	it("normal shutdown stops the child without reporting connection failure", async () => {
		const warn = vi.fn();
		const notifications = vi.fn();
		const stop = vi.fn(async () => {});
		let output: (chunk: string) => void = () => {};
		let initialized = false;
		const processes: IAccountProcess = {
			initialize: async () => {
				initialized = true;
			},
			spawn: (spec) => {
				output = spec.onOutput;
				return {
					done: new Promise(() => {}),
					stop,
					write: (data) => {
						const message = JSON.parse(data);
						if (message.method === "initialize")
							output(
								JSON.stringify({
									id: message.id,
									result: {
										userAgent: "codex/0.164.0",
										codexHome: "/data/codex",
										platformFamily: "unix",
										platformOs: "linux",
									},
								}) + "\n",
							);
					},
				};
			},
		};
		const connection = new CodexConnection(processes, sleep, 100, { warn, error: vi.fn() });
		connection.subscribe(notifications);
		await connection.initialize();
		expect(initialized).toBe(true);
		await connection.close();
		expect(stop).toHaveBeenCalledOnce();
		expect(warn).not.toHaveBeenCalled();
		expect(notifications).not.toHaveBeenCalled();
	});
	it("initializes once, correlates responses and rejects pending work on exit", async () => {
		let output: (chunk: string) => void = () => {};
		let exit: (code: number) => void = () => {};
		const sent: Record<string, unknown>[] = [];
		let starts = 0;
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: (spec: AccountProcessSpec) => {
				starts++;
				output = spec.onOutput;
				return {
					done: new Promise((resolve) => {
						exit = resolve;
					}),
					stop: async () => {
						exit(0);
					},
					write: (data) => {
						const message: Record<string, unknown> = JSON.parse(data);
						sent.push(message);
						if (message["method"] === "initialize")
							output(
								JSON.stringify({
									id: message["id"],
									result: {
										userAgent: "codex/0.164.0",
										codexHome: "/data/codex",
										platformFamily: "unix",
										platformOs: "linux",
									},
								}) + "\n",
							);
					},
				};
			},
		};
		const connection = new CodexConnection(processes, sleep, 100);
		await Promise.all([connection.initialize(), connection.initialize()]);
		expect(starts).toBe(1);
		expect(sent.map((value) => value["method"])).toEqual(["initialize", "initialized"]);
		const pending = connection.request("account/read", { refreshToken: true });
		exit(1);
		await expect(pending).rejects.toThrow("Codex connection unavailable");
		await connection.close();
	});

	it("bounds frames and request deadlines, and rejects unsupported methods", async () => {
		let output: (chunk: string) => void = () => {};
		let stopped = false;
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: (spec) => {
				output = spec.onOutput;
				return {
					done: new Promise(() => {}),
					stop: async () => {
						stopped = true;
					},
					write: (data) => {
						const message = JSON.parse(data);
						if (message.method === "initialize")
							output(
								JSON.stringify({
									id: message.id,
									result: {
										userAgent: "codex/0.164.0",
										codexHome: "/data/codex",
										platformFamily: "unix",
										platformOs: "linux",
									},
								}) + "\n",
							);
					},
				};
			},
		};
		const connection = new CodexConnection(processes, sleep, 10);
		await connection.initialize();
		await expect(connection.request("turn/start", {})).rejects.toThrow("Unsupported Codex operation");
		await expect(connection.request("account/read", {})).rejects.toThrow("Codex connection unavailable");
		expect(stopped).toBe(true);
		await connection.initialize();
		const pending = connection.request("account/read", {});
		output("x".repeat(1024 * 1024 + 1));
		await expect(pending).rejects.toThrow("Codex connection unavailable");
		await connection.close();
	});
});
