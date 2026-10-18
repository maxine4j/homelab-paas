# Access, ingress, and certificates

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing OAuth2, sessions, authorization, routes, forwarded headers, DNS, or certificate lifecycle.

Read related requirements only when the change crosses those boundaries: [configuration and storage](configuration-and-storage.md), [descriptors](descriptors.md), [management SPA and API](frontend.md).

## Ingress, DNS, and authentication

- Public DNS uses a wildcard directed at the host. Per-application routing is generated in Traefik; do not require per-service DNS API writes.
- Reserve `paas.<clusterDomain>` for management. Route the primary web resource at `<serviceId>.<clusterDomain>` and additional web resources at `<resourceId>--<serviceId>.<clusterDomain>`.
- Require valid hostnames, exactly one explicitly selected primary when a service has multiple web resources, and collision checks across all routes.
- Traefik terminates TLS and forwards authorization decisions for private routes to a private control-plane endpoint. Routes for web resources declaring `public: true` have no platform forward-auth middleware. Application bodies/streaming traffic flow through Traefik directly to the workload.
- The control plane owns login initiation, callback handling, sessions, logout, access policy, and forward-auth responses.
- Support human browser login using GitHub's OAuth2 authorization-code web flow with state validation, PKCE, and a maintained OAuth2 client library. Configure GitHub's OAuth2 endpoints explicitly; this flow does not supply OIDC ID tokens or discovery.
- Exchange the authorization code server-side and retrieve the authenticated identity from GitHub's user API. Match its current login case-insensitively against the list required by the requested route: `auth.github.allowedUsernames` for private application resources, `auth.github.adminUsernames` for management and control-plane operations. The configuration accepts usernames rather than requiring users to find numeric IDs.
- Bind sessions to immutable GitHub user IDs as well as the verified login. Recheck current allowlist policy on protected requests; removing a username must revoke its access without waiting for session expiry. Account renames do not silently bypass configured username rules.
- The lists are independent. Private-application access does not grant administration; administrator status does not implicitly grant private-application access. Put a username in both lists when both are intended. No automatic organization-membership grant exists.
- Management UI/API, onboarding, discovery previews, acceptance, source changes, and cluster/configuration mutations require `auth.github.adminUsernames`. The management route is platform-owned, always private, and cannot be overridden with a descriptor's `public` field.
- Request only required identity scopes. GitHub API/checkout read credentials are configured separately on the host and must not be obtained by silently requesting repository access during browser login.
- Keep OAuth2 credentials and provider tokens server-side. Do not forward them to applications or expose them to the SPA. No local passwords, identity-provider service, or machine-login flow is required initially.
- GitHub authentication alone is insufficient: private routes require membership in their applicable host-configured list. Organizations configured for scanning confer no access rights.
- Deny access by default: an omitted `public` means `public: false`, not an unprotected route. A descriptor cannot broaden either username list. Missing/invalid configuration must not produce public access. Organization/team membership authorization is outside v1.
- Reject spoofed identity headers. Derive authorization from a validated session and a platform-owned route registry, not an untrusted caller-supplied service ID or forwarded host.
- Traefik strips inbound identity headers and sets only the allowlisted trusted identity headers returned by the control plane.
- Public resources bypass platform authentication entirely; do not call the auth proxy just to return an allow response. Continue stripping untrusted identity headers. An application's own native authentication may still apply.
- Protect session cookies, enforce CSRF/origin checks for mutations, validate return URLs, bound session lifetimes, and persist signing material across restarts.
- Avoid a broad parent-domain session cookie readable/usable across arbitrary applications. Prefer an isolated management/auth origin and explicit application session exchange.
- The API authorizes every management operation independently of SPA routing. SPA hiding is not access control.
- Direct workload networking remains controlled by NetworkPolicy; do not expose alternate public routes that bypass the intended ingress policy.
- Existing apps using native authentication or non-browser clients can explicitly set `public: true` to bypass platform OAuth2 for that web resource. v1 does not infer public path exceptions within a private resource.

## Certificate lifecycle

- The custom manager speaks to Let's Encrypt using a maintained asynchronous ACME library compatible with Node 24. Select the package with owner approval before implementation.
- Use DigitalOcean DNS-01 initially, requesting `*.<clusterDomain>` and the apex if the apex is used. Do not implement multiple DNS providers before a requirement exists.
- Persist ACME registration/account keys, private keys, issued chains, order state, and renewal metadata under platform state with restrictive permissions.
- Issue/renew certificates centrally and publish the resulting Kubernetes TLS Secret for Traefik to consume.
- Disable competing Traefik ACME issuance. There must be exactly one owner of a certificate's lifecycle.
- Handle propagation checks, DNS TXT cleanup, concurrent challenges, retries, backoff, expiry alerts, and recovery from interrupted orders.
- Keep the current valid certificate active while renewal is pending or failing. Replace the active key/chain together after validation.
- Use Let's Encrypt staging for automated integration tests and development. Avoid production issuance on every startup or reconciliation.
- Obtain the first valid certificate using the file-provided DigitalOcean/ACME configuration before enabling management login/onboarding. Never use an untrusted/self-signed certificate or plaintext secret-entry flow as a bootstrap shortcut.

## Required verification

- Test omitted/false `public` protection, explicit `public: true` bypass without an auth-proxy call, and invalid flag values. Verify private-app-only users cannot access management, admin-only users do not implicitly access private apps, users in both lists have both permissions, list revocation affects existing sessions, and discovery-owner configuration grants no access rights.

- Use ACME staging or a local test server and a controlled GitHub OAuth2/API test double; CI must not need production credentials. Match GitHub's actual OAuth2/user-API behaviour rather than assuming OIDC semantics.

## Reference documentation

- [GitHub OAuth2 web application flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub authenticated user API](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
- [GitHub OAuth web flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Let's Encrypt documentation](https://letsencrypt.org/docs/)
