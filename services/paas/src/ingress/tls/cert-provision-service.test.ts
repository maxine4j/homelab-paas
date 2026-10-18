import { expect, it, vi } from "vitest";
import { TlsCertProvisionService } from "./cert-provision-service.ts";

it("requests apex and wildcard certificates using supplied ACME contact settings", async () => {
  const issueCertificate = vi.fn(async () => ({ key: "key", cert: "cert" }));
  const service = new TlsCertProvisionService(
    { rootDomain: "example.com", email: "admin@example.com" },
    { issueCertificate },
  );
  const signal = new AbortController().signal;
  expect(await service.provisionCert(signal)).toEqual({ key: "key", cert: "cert" });
  expect(issueCertificate).toHaveBeenCalledWith(
    { altNames: ["example.com", "*.example.com"], email: "admin@example.com" },
    signal,
  );
});
