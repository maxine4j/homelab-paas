import { expect, test, vi } from "vitest";

import { TlsCertProvisionService } from "./cert-provision-service.ts";

test("requests one certificate covering the platform base domain and wildcard", async () => {
	const provision = vi.fn(async () => ({ key: "key", cert: "cert" }));
	const service = new TlsCertProvisionService(
		{ baseDomain: "apps.example.com", email: "admin@example.com" },
		{ provision },
	);
	expect(await service.provisionCert()).toEqual({ key: "key", cert: "cert" });
	expect(provision).toHaveBeenCalledWith({
		domains: ["apps.example.com", "*.apps.example.com"],
		email: "admin@example.com",
	});
});
