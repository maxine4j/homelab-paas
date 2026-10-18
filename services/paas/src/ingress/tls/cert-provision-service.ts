export interface CertificateBundle {
  key: string;
  cert: string;
}
export interface CertificateRequest {
  altNames: string[];
  email: string;
}
export interface CertificateAuthority {
  /** Throws CertificateProvisionError on issuance failure. */
  issueCertificate(request: CertificateRequest, signal?: AbortSignal): Promise<CertificateBundle>;
}
export interface CertificateProvisioner {
  /** Throws CertificateProvisionError on issuance failure. */
  provisionCert(signal?: AbortSignal): Promise<CertificateBundle>;
}
export class CertificateProvisionError extends Error {
  constructor() {
    super("Certificate issuance failed");
  }
}

export class TlsCertProvisionService implements CertificateProvisioner {
  private readonly config: { rootDomain: string; email: string };
  private readonly authority: CertificateAuthority;
  constructor(config: { rootDomain: string; email: string }, authority: CertificateAuthority) {
    this.config = config;
    this.authority = authority;
  }

  provisionCert(signal?: AbortSignal): Promise<CertificateBundle> {
    return this.authority.issueCertificate(
      {
        altNames: [this.config.rootDomain, `*.${this.config.rootDomain}`],
        email: this.config.email,
      },
      signal,
    );
  }
}
