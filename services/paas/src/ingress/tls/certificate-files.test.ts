import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import acme from "acme-client";
import { expect, it } from "vitest";
import { CertificateFileStore, X509CertificateInspector } from "./certificate-files.ts";

it("atomically persists a certificate/key pair with restrictive permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paas-tls-"));
  try {
    const store = new CertificateFileStore(directory);
    expect(await store.load()).toBeUndefined();
    const bundle = {
      key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
      cert: "-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----\n",
    };
    await store.save(bundle);
    expect(await store.load()).toEqual(bundle);
    expect((await stat(join(directory, "certificate.pem"))).mode & 0o777).toBe(0o600);
    const replacement = { ...bundle, cert: bundle.cert.replace("chain", "renewed") };
    await store.save(replacement);
    expect(await store.load()).toEqual(replacement);
    expect(await readFile(join(directory, "certificate.pem"), "utf8")).not.toContain("chain");
    await writeFile(join(directory, "certificate.pem"), "corrupt");
    await expect(store.load()).rejects.toThrow("Certificate storage failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("checks real X509 validity and refuses malformed or mismatched private keys", async () => {
  const [key, cert] = await acme.crypto.createAlpnCertificate(
    {
      url: "authz",
      status: "pending",
      identifier: { type: "dns", value: "example.com" },
      challenges: [],
    },
    "authorization",
  );
  const inspector = new X509CertificateInspector();
  const bundle = { key: key.toString(), cert: cert.toString() };
  const validity = inspector.inspect(bundle);
  expect(Number.isFinite(validity.validFrom.getTime())).toBe(true);
  expect(validity.validTo.getTime()).toBeGreaterThanOrEqual(validity.validFrom.getTime());
  const otherKey = await acme.crypto.createPrivateEcdsaKey();
  expect(() => inspector.inspect({ ...bundle, key: otherKey.toString() })).toThrow(
    "Invalid certificate material",
  );
  expect(() => inspector.inspect({ ...bundle, cert: "broken" })).toThrow(
    "Invalid certificate material",
  );
});
