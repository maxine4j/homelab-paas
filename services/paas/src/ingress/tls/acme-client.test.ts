import acme from "acme-client";
import { expect, test, vi } from "vitest";

import { AcmeClient } from "./acme-client.ts";

test("reuses the persisted ACME account and isolates overlapping DNS challenge cleanup", async () => {
	const record1 = { zone: "example.com", id: 1 };
	const record2 = { zone: "example.com", id: 2 };
	const createChallenge = vi.fn().mockResolvedValueOnce(record1).mockResolvedValueOnce(record2);
	const removeChallenge = vi.fn(async () => {});
	const writeAccountKey = vi.fn(async () => {});
	const createPrivateKey = vi.fn(async () => Buffer.from("account-key"));
	const createCsr = vi.fn(async (): Promise<[Buffer, Buffer]> => [Buffer.from("private-key"), Buffer.from("csr")]);
	const auto = vi.fn(async (options: acme.ClientAutoOptions) => {
		const authz = { identifier: { value: "apps.example.com", type: "dns" } } as acme.Authorization;
		const first = { type: "dns-01", url: "first" } as Parameters<typeof options.challengeCreateFn>[1];
		const second = { type: "dns-01", url: "second" } as Parameters<typeof options.challengeCreateFn>[1];
		await options.challengeCreateFn(authz, first, "value1");
		await options.challengeCreateFn(authz, second, "value2");
		await options.challengeRemoveFn(authz, first, "value1");
		await options.challengeRemoveFn(authz, second, "value2");
		return "certificate";
	});
	let clientOptions: acme.ClientOptions | undefined;
	// The SDK is injected at this adapter boundary; no application module mocks.
	const sdk = {
		...acme,
		crypto: { ...acme.crypto, createPrivateKey, createCsr },
		Client: class {
			constructor(options: acme.ClientOptions) {
				clientOptions = options;
			}
			auto = auto;
		} as unknown as typeof acme.Client,
	};
	const service = new AcmeClient(
		{ createChallenge, removeChallenge },
		{ readAccountKey: async () => "existing-key", writeAccountKey },
		sdk,
	);
	const request = { domains: ["apps.example.com", "*.apps.example.com"], email: "admin@example.com" };
	expect(await service.provision(request)).toEqual({ key: "private-key", cert: "certificate" });
	expect(clientOptions).toEqual({ directoryUrl: acme.directory.letsencrypt.production, accountKey: "existing-key" });
	expect(createPrivateKey).not.toHaveBeenCalled();
	expect(writeAccountKey).not.toHaveBeenCalled();
	expect(createCsr).toHaveBeenCalledWith({ altNames: ["apps.example.com", "*.apps.example.com"] });
	expect(auto).toHaveBeenCalledWith(
		expect.objectContaining({
			email: "admin@example.com",
			termsOfServiceAgreed: true,
			challengePriority: ["dns-01"],
		}),
	);
	expect(removeChallenge.mock.calls).toEqual([[record1], [record2]]);
	const fresh = new AcmeClient(
		{ createChallenge, removeChallenge },
		{ readAccountKey: async () => undefined, writeAccountKey },
		sdk,
	);
	await fresh.provision(request);
	expect(writeAccountKey).toHaveBeenCalledWith("account-key");
	auto.mockRejectedValue(new Error("SECRET"));
	await expect(service.provision(request)).rejects.toThrow("Certificate provisioning failed");
});
