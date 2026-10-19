import { createPrivateKey } from "node:crypto";

import acme from "acme-client";
import { afterEach, expect, it } from "vitest";

import { AcmeSdkSession } from "./acme-client.ts";

const originalDefaults = { ...acme.axios.defaults };
afterEach(() => {
	Object.assign(acme.axios.defaults, originalDefaults);
	if (originalDefaults.signal === undefined) delete acme.axios.defaults.signal;
	if (originalDefaults.maxRedirects === undefined) delete acme.axios.defaults.maxRedirects;
});

it.each(["staging", "production"] as const)(
	"the SDK session selects Let's Encrypt %s and bounds authenticated HTTP requests",
	async (environment) => {
		const signal = new AbortController().signal;
		const accountKey = (await acme.crypto.createPrivateKey()).toString();
		const session = new AcmeSdkSession({ environment, accountKey }, signal);
		const names = ["example.com", "*.example.com"];
		const { key, csr } = await session.createCsr(names);
		expect(createPrivateKey(key).type).toBe("private");
		expect(acme.crypto.readCsrDomains(csr).altNames).toEqual(names);
		let requests = 0;
		acme.axios.defaults.adapter = async (config) => {
			requests++;
			expect(config.url).toBe(acme.directory.letsencrypt[environment]);
			expect(config.timeout).toBe(30_000);
			expect(config.maxRedirects).toBe(0);
			expect(config.signal).toBe(signal);
			throw new Error("test transport stopped");
		};
		await expect(
			session.auto({
				csr,
				termsOfServiceAgreed: true,
				challengeCreateFn: async () => {},
				challengeRemoveFn: async () => {},
			}),
		).rejects.toThrow("test transport stopped");
		expect(requests).toBe(1);
	},
);
