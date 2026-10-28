# Networking and authentication

Management WebSocket upgrades are restricted to `/api/ui/live`, preserve the existing session authorization/cookies and disable route request/idle timeouts for long-lived streams. Workload routes do not enable upgrades. The protocol, direct-upgrade protection and open-session revalidation are defined in [live management subscriptions](management-ui.md#live-subscriptions).

The [deployment runtime](configuration.md#implemented-deployment-mvp) supports public HTTP for local development and authenticated HTTPS when auth/TLS are configured. The internal listener and inter-service discovery remain deferred. The control plane and Envoy attach to each service's dedicated Docker network. Workloads publish no host ports by default; explicit [host ports](configuration.md#host-ports) connect directly to web or worker applications outside Envoy's authentication, TLS and readiness controls. Bootstrap containers must carry `homelab-paas.cluster={clusterId}` and `homelab-paas.role=control-plane` or `envoy` labels so the control plane can discover them. Envoy loads generated filesystem xDS from the shared platform state directory. Its administration/configuration interfaces have no published ports. Later sections also describe intended capabilities beyond this runtime.

## Networking

The reconciler uses `INetworkingService.routeTo` with a `{resourceId}.{serviceId}` routing identity to switch a ready resource endpoint and `withdraw` to stop assigning new requests before container retirement. Each endpoint includes its public/private and primary policies. `NetworkingService` serializes updates across services and records desired endpoints in its injected endpoints store before publication. Failed or uncertain publication retains that desired state for retry; callers must retain containers that may receive traffic. Startup supplies `EndpointsStore` over a shared YAML key-value store for persistent endpoints; in-memory storage remains available for tests. Domain validation is identical for both adapters. Legacy service-only persisted routes remain usable until a primary resource is republished. Any resource recreation withdraws an unowned legacy service-only route before retirement; modern routes for other resources remain intact. Publishing a new primary atomically transfers the alias marker in the desired endpoint snapshot.

`EnvoyService` converts plain endpoint values (including the ingress public/private policy) into external routing, health checks, and optional authorization/TLS configuration. `EnvoyClient` serializes filesystem xDS, waits for active CDS resources before publishing LDS, and confirms active listeners through the private admin `/config_dump` API with bounded polling, including retries while the admin API starts. Unchanged resources may retain earlier per-resource versions; acceptance checks the discovery version, active resource identities, and absence of warming replacements. `NodeEnvoyTransport` owns atomic discovery-file replacement through the canonical file utility and bounded admin HTTP I/O. Startup uses the shared platform state directory and `http://envoy:9901` for private admin access, with 30 acceptance attempts one second apart and a two-second HTTP timeout. Before starting the control-plane health server, startup awaits `EnvoyService.bootstrap()`, which delegates bootstrap serialization to `EnvoyClient` and exclusive discovery-file creation to the transport. Missing `cds.yaml` and `lds.yaml` receive `version_info: bootstrap` and an empty resource list in a private directory; existing discovery files and persisted state are preserved. Bootstrap failures prevent startup. The internal listener remains deferred.

Each service receives a dedicated Docker network.

- Resources within a service communicate directly using resource names, such as `store:5432`.
- Resources in different services have no direct service-network connectivity; explicitly published host ports are reachable according to host routing and firewall rules.
- Envoy connects to each service network and routes inter-service traffic.
- Workload ports are published only when explicitly configured with `hostPorts`.
- Envoy’s external ingress ports provide platform-managed HTTP ingress.

Envoy uses separate external and internal listeners. The internal listener, administration interface, and configuration interfaces must not be externally accessible.

No authentication or authorization is enforced for internal communication. All workloads are therefore treated as trusted peers.

### Inter-service discovery

A web or worker resource may declare:

```yaml
egress:
    - another-service
```

The platform injects:

```dotenv
PAAS_EGRESS_URL_ANOTHER_SERVICE=http://another-service.internal:8080
PAAS_EGRESS_HOST_ANOTHER_SERVICE=another-service.internal
PAAS_EGRESS_PORT_ANOTHER_SERVICE=8080
```

The hostname resolves to Envoy’s internal listener. Envoy routes the request to the destination service’s web resource.

`egress` declarations provide connection information only; they do not restrict access.

Generated environment-variable names must be unambiguous. Normalization collisions are rejected.

## External ingress and authentication

Every web resource, including a sole implicit primary, has this external URL:

```text
https://{resourceId}.{serviceId}.{baseDomain}
```

The [primary web resource](configuration.md#service-descriptors) also receives `https://{serviceId}.{baseDomain}`. Both hostnames route to the same resource and use its authentication policy. Other web resources retain independent endpoints, health checks and policies. Local deployments without TLS use the same names over HTTP; nonstandard ingress ports appear in URLs.

Web resources declare their application port and authentication policy:

```yaml
ingress:
    public: false
    port: 3000
```

`public` defaults to `false`.

Every application request through Envoy ingress passes through its authorization check against the control plane:

- Private ingress requires a valid platform JWT session.
- Public ingress allows access without a platform session.
- Applications using public ingress manage their own authentication where required.
- Authorization-check failures fail closed.

Login and OAuth callback routes are exempt from requiring an existing session.

### GitHub login and JWT sessions

The control plane implements GitHub OAuth login. A configured GitHub user allowlist determines who may create a session. `AuthService` derives the callback URL from the configured ingress domain and HTTPS port and supplies the same URL to the provider for authorization and token exchange. See [configuration](configuration.md#implemented-deployment-mvp) for the derived URL to register with GitHub.

After successful login, the platform issues a local JWT session using secure, HTTP-only cookies. It validates the signature, issuer, audience, and expiration on subsequent requests.

GitHub is contacted during login, not for each application request.

Login must work across service hostnames without exposing platform session tokens to hosted applications.

Envoy's HTTPS listener performs HTTP `ext_authz` checks against the private control-plane `/auth/check` prefix for every application request, including public ingress. The control plane reads the persisted routing policy, validates sessions locally, and replaces the upstream `Cookie` header with only application cookies. Platform cookies are stripped for both public and private applications; other application credentials are preserved. Unknown services are denied and authorization errors fail closed.

Private requests without a valid session redirect to `https://auth.{baseDomain}/oauth/github/login`, preserving the original URL in validated OAuth state. Only login and `/auth/callback` are routed to the control plane on that hostname; the authorization endpoint and management paths are never exposed there. Login targets must use a configured service hostname, a resource hostname within a configured service, or the [management UI's base hostname](management-ui.md), with the configured HTTPS port. Authorization still requires an actual published endpoint for resource requests. Signed, ten-minute OAuth state is bound to a random browser nonce in a host-only, secure, HTTP-only cookie and cleared on callback. The GitHub username allowlist is checked before issuing a session and on session validation.

Sessions use the secure, HTTP-only `__Secure-paas_session` cookie scoped to the base domain with `SameSite=Lax`; Envoy removes it before proxying to workloads. JWTs use HS256 with required signature, issuer, audience, purpose, and expiration validation. OAuth state and session tokens have distinct purposes. Application-provided duplicate platform cookies do not authenticate a request. GitHub access tokens are used only during login and are never stored in session cookies. There is no service-specific allowlist or administrator role in the current contract.

Public ingress is the compatibility option for applications whose native clients cannot complete platform login.

## TLS

The control plane provisions and renews one Let’s Encrypt certificate covering:

```text
{baseDomain}
*.{baseDomain}
*.{serviceId}.{baseDomain}  (for every configured service)
```

Validation uses DNS-01. **DigitalOcean is the only supported DNS provider in v1.**

The platform owns certificate paths, ACME account storage, renewal timing, and Envoy certificate updates. These are not configurable.

Renewal must update Envoy without restarting workloads. Renewal failures retain the current certificate and report an error.

The production ACME account key persists at `_paas/acme-account.pem`. A base-domain wildcard does not cover nested resource names, so each configured service receives its own wildcard SAN. DigitalOcean zone discovery selects the longest managed suffix of each challenged name; challenge records are tracked individually and cleanup removes only records created for that challenge. The certificate chain and matching private key are validated before atomic replacement of `_paas/ingress.pem`. `_paas/sds.yaml` references that combined PEM; filesystem SDS watches its directory and reloads Envoy's TLS context on replacement. Private material uses mode `0600` within the platform state directory. ACME issuance limits still apply; provisioning errors retain full operator diagnostics and never silently omit required names.

Startup checks the actual persisted certificate SANs and provisions missing coverage, including certificates issued before resource hostnames were supported, before publishing the HTTPS listener. Coverage and expiry checks then run every sixty seconds and renew with fewer than thirty days remaining or when configured service additions require new wildcard SANs. Removing a service does not force renewal. A renewal failure retains an existing usable certificate; startup fails if no usable certificate exists. Names absent from the retained certificate remain unusable over verified TLS until issuance succeeds. HTTPS port publication remains an operator/bootstrap responsibility; the local Compose fixture publishes loopback ports 80 and 443 for `local.maxine4j.com`.

DNS records pointing the base domain, service and authentication hostnames, and nested resource hostnames (or per-service wildcard records) at the Docker host are an operator prerequisite. Certificate DNS-01 automation creates challenge TXT records only; application DNS remains operator-managed.

See [configuration](configuration.md) for complete platform and service examples and [reconciliation and deployments](reconciliation-and-deployments.md) for routing changes during rollout.
