import { sleep } from "@homelab-paas/backend-infrastructure/sleep";
import { describe, expect, it } from "vitest";

import type { IAccountProcess } from "./account-process.ts";
import { GithubAccountClient } from "./github-account-client.ts";

describe("GithubAccountClient", () => {
	it("permits explicit retry after a failed process even while verification is unavailable", async () => {
		let starts = 0;
		let finish: (code: number) => void = () => {};
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: (spec) => {
				if (spec.arguments[0] === "api") throw new Error("network unavailable");
				starts++;
				queueMicrotask(() =>
					spec.onOutput(
						"First copy your one-time code: ABCD-EFGH\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
					),
				);
				return {
					done: new Promise((resolve) => {
						finish = resolve;
					}),
					write: () => {},
					stop: async () => {
						finish(1);
					},
				};
			},
		};
		const client = new GithubAccountClient(processes, sleep, { pending: async () => false, save: async () => {} });
		await client.start();
		finish(1);
		await Promise.resolve();
		await client.start();
		expect(starts).toBe(2);
		await client.close();
	});
	it("extracts only the supported device URL/code and verifies the account after login exits", async () => {
		let complete: (code: number) => void = () => {};
		let verified = false;
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: (spec) => {
				if (spec.arguments[0] === "api") {
					spec.onOutput(JSON.stringify({ login: "owner", token: "SECRET" }));
					verified = true;
					return { done: Promise.resolve(0), write: () => {}, stop: async () => {} };
				}
				queueMicrotask(() =>
					spec.onOutput(
						"! First copy your one-time code: ABCD-EFGH\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
					),
				);
				return {
					done: new Promise((resolve) => {
						complete = resolve;
					}),
					write: () => {},
					stop: async () => {
						complete(1);
					},
				};
			},
		};
		const client = new GithubAccountClient(processes, sleep, { pending: async () => false, save: async () => {} });
		expect(await client.start()).toMatchObject({ login: { state: "pending", userCode: "ABCD-EFGH" } });
		expect(verified).toBe(false);
		complete(0);
		expect(await client.status()).toMatchObject({ account: { name: "owner" }, login: { state: "completed" } });
		expect(JSON.stringify(await client.status())).not.toContain("SECRET");
		await client.close();
	});
	it("cancels and clears device codes without reporting success, and bounds a silent login", async () => {
		let stopped = 0;
		let pending = false;
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: () => ({
				done: new Promise(() => {}),
				write: () => {},
				stop: async () => {
					stopped++;
				},
			}),
		};
		const client = new GithubAccountClient(
			processes,
			sleep,
			{
				pending: async () => false,
				save: async (_provider, value) => {
					pending = value;
				},
			},
			10,
			100,
		);
		expect(await client.start()).toMatchObject({ login: { state: "failed", failure: "login-failed" } });
		expect(stopped).toBeGreaterThan(0);
		expect(pending).toBe(false);
		expect(await client.cancel()).toMatchObject({ login: { state: "cancelled" } });
		await client.close();
	});
	it("reports an interrupted attempt after restart even when verification is unavailable", async () => {
		const processes: IAccountProcess = {
			initialize: async () => {},
			spawn: () => {
				throw new Error("Missing gh SECRET");
			},
		};
		const client = new GithubAccountClient(processes, sleep, { pending: async () => true, save: async () => {} });
		expect(await client.status()).toMatchObject({
			connection: "unavailable",
			login: { state: "uncertain", failure: "connection-lost" },
		});
		await client.close();
	});
});
