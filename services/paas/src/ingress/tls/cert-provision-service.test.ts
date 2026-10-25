import { expect, test, vi } from "vitest";

import { testConfig } from "../../util/test/config.ts";
import { TlsCertProvisionService } from "./cert-provision-service.ts";

test("requests one certificate covering the platform base domain and wildcard", async () => {
	const provision = vi.fn(async () => ({ key: "key", cert: "cert" }));
	const service = new TlsCertProvisionService(
		testConfig({
			ingress: { ...testConfig().getIngressConfig(), baseDomain: "apps.example.com" },
			tls: { ...testConfig().getTlsConfig()!, acme: { email: "admin@example.com" } },
		}),
		{ provision },
	);
	expect(await service.provisionCert()).toEqual({ key: "key", cert: "cert" });
	expect(provision).toHaveBeenCalledWith({
		domains: ["apps.example.com", "*.apps.example.com"],
		email: "admin@example.com",
	});
});

test("covers nested resources for every configured service and follows additions", async () => {
	const config = testConfig({ services: { demo: { remote: "local", descriptorPath: "/repo/demo.yaml" } } });
	const provision = vi.fn(async () => ({ key: "key", cert: "cert" }));
	const service = new TlsCertProvisionService(config, { provision });
	await service.provisionCert();
	expect(provision.mock.calls.at(-1)?.at(0)).toMatchObject({
		domains: ["example.test", "*.example.test", "*.demo.example.test"],
	});
	config.getConfig().services["other"] = { remote: "local", descriptorPath: "/repo/other.yaml" };
	await service.provisionCert();
	expect(provision.mock.calls.at(-1)?.at(0)).toMatchObject({
		domains: ["example.test", "*.example.test", "*.demo.example.test", "*.other.example.test"],
	});
});
