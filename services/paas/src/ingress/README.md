# OAuth and TLS modules

Ported from local `main`, adapted to this branch's ESM, dependency injection, and Vitest conventions. No reverse-proxy modules or routes are included.

`createOauthProvider` in `start.ts` constructs the GitHub client from explicit client credentials and a registered callback URL. The caller supplies state and an S256 PKCE challenge/verifier and owns state validation, return URLs, sessions, and access policy. User details include the immutable GitHub ID and normalized username; only verified primary email is returned. This module does not enable browser login by itself.

`createTlsRenewalTask` constructs the DigitalOcean DNS-01 client, Let's Encrypt ACME client, certificate provisioner, and renewal task. Supply an existing private certificate directory, contact email, a stable account key loaded from platform storage, and the appliance shutdown signal. Reuse one task/client stack per appliance; acme-client's shared HTTP transport uses that lifetime signal, a 30-second request timeout, and no redirects. DNS propagation verification and bounded ACME retries use acme-client. Cleanup gets its own bounded DNS requests so shutdown does not prevent deleting TXT records.

The renewal task loads existing material, activates it when valid, and renews below 30 days remaining. It validates key matching and certificate dates, atomically persists the pair in mode-0600 `certificate.pem`, then calls an injected certificate target. The directory must be private and platform-owned. Storage failures stop subsequent writes on that store instance; restart/recovery reloads the committed pair. Old separate `key.pem`/`cert.pem` files are not migrated automatically.

These factories are not invoked by the current HTTP startup. Scheduling, persistent ACME account/order recovery, Kubernetes TLS Secret publication, and management authentication integration remain separate work. Tests use controlled HTTP/ACME doubles and temporary files; no real GitHub credentials or certificate issuance are required.
