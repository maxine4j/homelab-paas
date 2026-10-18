import type { Authorization, ClientAutoOptions } from "acme-client";
import { expect, it, vi } from "vitest";
import { AcmeCertificateClient } from "./acme-client.ts";

const challenge = {
  type: "dns-01",
  url: "challenge-url",
  status: "pending",
  token: "token",
} as const;
const authz: Authorization = {
  url: "authorization-url",
  status: "pending",
  challenges: [challenge],
  identifier: { type: "dns", value: "example.com" },
};

it("maps ACME callbacks into independent DNS challenges and always retries cleanup", async () => {
  const createChallenge = vi.fn(async () => {});
  const removeChallenge = vi.fn(async () => {});
  const client = new AcmeCertificateClient(
    {
      auto: async (options: ClientAutoOptions) => {
        expect(options.email).toBe("admin@example.com");
        expect(options.challengePriority).toEqual(["dns-01"]);
        expect(options.skipChallengeVerification).toBeUndefined();
        await options.challengeCreateFn(authz, challenge, "value");
        await options.challengeRemoveFn(authz, challenge, "value");
        return "certificate";
      },
    },
    async (names) => {
      expect(names).toEqual(["example.com", "*.example.com"]);
      return { key: "key", csr: "csr" };
    },
    { createStatefulChallenge: () => ({ createChallenge, removeChallenge }) },
  );
  expect(
    await client.issueCertificate({
      altNames: ["example.com", "*.example.com"],
      email: "admin@example.com",
    }),
  ).toEqual({ key: "key", cert: "certificate" });
  expect(createChallenge).toHaveBeenCalledWith("challenge-url", "example.com", "value", undefined);
  expect(removeChallenge).toHaveBeenCalledWith("challenge-url");
});

it("cleans up outstanding challenges even when ACME fails before its remove callback", async () => {
  const removeChallenge = vi.fn(async () => {});
  const client = new AcmeCertificateClient(
    {
      auto: async (options) => {
        await options.challengeCreateFn(authz, challenge, "value");
        throw new Error("vendor error with credentials");
      },
    },
    async () => ({ key: "key", csr: "csr" }),
    { createStatefulChallenge: () => ({ createChallenge: async () => {}, removeChallenge }) },
  );
  await expect(
    client.issueCertificate({ altNames: ["example.com"], email: "admin@example.com" }),
  ).rejects.toThrow("Certificate issuance failed");
  expect(removeChallenge).toHaveBeenCalledWith("challenge-url");
});

it("rejects unsupported challenge types and cancellation without creating DNS records", async () => {
  const createChallenge = vi.fn(async () => {});
  const client = new AcmeCertificateClient(
    {
      auto: async (options) => {
        await options.challengeCreateFn(authz, { ...challenge, type: "http-01" }, "value");
        return "cert";
      },
    },
    async () => ({ key: "key", csr: "csr" }),
    { createStatefulChallenge: () => ({ createChallenge, removeChallenge: async () => {} }) },
  );
  await expect(
    client.issueCertificate({ altNames: ["example.com"], email: "admin@example.com" }),
  ).rejects.toThrow("Certificate issuance failed");
  await expect(
    client.issueCertificate(
      { altNames: ["example.com"], email: "admin@example.com" },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow("Certificate issuance failed");
  expect(createChallenge).not.toHaveBeenCalled();
});
