import { constants } from "node:fs";
import { mkdtemp, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createPrivateKey, X509Certificate } from "node:crypto";
import type { CertificateBundle } from "./cert-provision-service.ts";
import type { CertificateInspector, CertificateStore } from "./cert-renewal-task.ts";

export class CertificateStorageError extends Error {
  constructor() {
    super("Certificate storage failed");
  }
}

/** The configured directory must already exist, be private, and belong to the platform. */
export class CertificateFileStore implements CertificateStore {
  private readonly directory: string;
  private failed = false;
  constructor(directory: string) {
    this.directory = directory;
  }

  async load(): Promise<CertificateBundle | undefined> {
    try {
      const file = await open(
        join(this.directory, "certificate.pem"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 1024 * 1024 || (info.mode & 0o077) !== 0)
          throw new CertificateStorageError();
        const pem = await file.readFile("utf8");
        const start = pem.indexOf("-----BEGIN CERTIFICATE-----");
        if (start < 0 || !pem.slice(0, start).includes("PRIVATE KEY-----"))
          throw new CertificateStorageError();
        return { key: pem.slice(0, start), cert: pem.slice(start) };
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new CertificateStorageError();
    }
  }

  async save(bundle: CertificateBundle): Promise<void> {
    if (this.failed) throw new CertificateStorageError();
    let temporary: string | undefined;
    try {
      temporary = await mkdtemp(join(this.directory, ".certificate-"));
      const path = join(temporary, "certificate.pem");
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(`${bundle.key.trim()}\n${bundle.cert.trim()}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(path, join(this.directory, "certificate.pem"));
      const directory = await open(
        this.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // A directory-sync failure may follow a committed rename: require recovery.
      this.failed = true;
      throw new CertificateStorageError();
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}

export class X509CertificateInspector implements CertificateInspector {
  inspect(bundle: CertificateBundle): { validFrom: Date; validTo: Date } {
    try {
      const certificate = new X509Certificate(bundle.cert);
      if (!certificate.checkPrivateKey(createPrivateKey(bundle.key)))
        throw new Error("mismatched key");
      return { validFrom: new Date(certificate.validFrom), validTo: new Date(certificate.validTo) };
    } catch {
      throw new Error("Invalid certificate material");
    }
  }
}
