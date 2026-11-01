# Networking and authentication

Management WebSocket upgrades are restricted to `/api/ui/live`, preserve the existing session authorization/cookies and disable route request/idle timeouts for long-lived streams. The protocol, direct-upgrade protection and open-session revalidation are defined in [live management subscriptions](management-ui.md#live-subscriptions). Workload WebSockets follow the [workload upgrade contract](#workload-websockets).

The [deployment runtime](configuration.md#implemented-deployment-mvp) supports public HTTP for local development and authenticated HTTPS when auth/TLS are configured. The internal listener and inter-service discovery remain deferred. The control plane and Envoy attach to each service's dedicated Docker network. Workloads publish no host ports by default; explicit [host ports](configuration.md#host-ports) connect directly to web or worker applications outside Envoy's authentication, TLS and readiness controls. Bootstrap containers must carry `homelab-paas.cluster={clusterId}` and `homelab-paas.role=control-plane` or `envoy` labels so the control plane can discover them. Envoy loads generated filesystem xDS from the shared platform state directory. Its administration/configuration interfaces have no published ports. Later sections also describe intended capabilities beyond this runtime.

## Networking

The reconciler uses `INetworkingService.routeTo` with a `{resourceId}.{serviceId}` routing identity to switch a ready resource endpoint and `withdraw` to stop assigning new requests before container retirement. Each endpoint includes its public/private and primary policies. `NetworkingService` serializes updates across services and records desired endpoints in its injected endpoints store before publication. Failed or uncertain publication retains that desired state for retry; callers must retain containers that may receive traffic. Startup supplies `EndpointsStore` over a shared YAML key-value store for persistent endpoints; in-memory storage remains available for tests. Domain validation is identical for both adapters. Legacy service-only persisted routes remain usable until a primary resource is republished. Any resource recreation withdraws an unowned legacy service-only route before retirement; modern routes for other resources remain intact. Publishing a new primary atomically transfers the alias marker in the desired endpoint snapshot.

`EnvoyService` converts plain endpoint values (including the ingress public/private policy) into external routing, health checks, and optional authorization/TLS configuration. `EnvoyClient` serializes filesystem xDS, waits for active CDS resources before publishing LDS, and confirms active listeners through the private admin `/config_dump` API with bounded polling, including retries while the admin API starts. Unchanged resources may retain earlier per-resource versions; acceptance checks the discovery version, active resource identities, and absence of warming replacements. `NodeEnvoyTransport` owns atomic discovery-file replacement through the canonical file utility and bounded admin HTTP I/O. Startup uses the shared platform state directory and `http://envoy:9901` for private admin access, with 30 acceptance attempts one second apart and a two-second HTTP timeout. Before starting the control-plane health server, startup awaits `EnvoyService.bootstrap()`, which delegates bootstrap serialization to `EnvoyClient` and exclusive discovery-file creation to the transport. Missing `cds.yaml` and `lds.yaml` receive `version_info: bootstrap` and an empty resource list in a private directory; existing discovery files and persisted state are preserved. Bootstrap failures prevent startup. The internal listener remains deferred.

Each service receives a dedicated Docker network.

Docker events and the [safety audit](reconciliation-and-deployments.md#docker-events-and-safety-audit) detect supported attachment/alias and infrastructure peer drift. Event attributes never replace fresh ownership/readiness checks. Audit verification retains persisted routes; targeted reconciliation repairs endpoints only after fresh readiness.

`EnvoyClient` remembers only completely confirmed generated CDS/LDS content. Identical confirmed content skips discovery writes and admin polling; any changed or uncertain publication discards the earlier confirmation and must retry. Generated configuration includes endpoint policies, ingress hostnames/ports and authorization/TLS listeners, so relevant configuration changes cannot reuse an incompatible publication. `NetworkingService.verifyRoutes` explicitly republishes and confirms discovery at startup and for audit callers, bypassing this optimization to repair persisted discovery or live routing drift. It optionally accepts a complete freshly observed desired endpoint snapshot to repair persisted endpoint drift too. That snapshot must retain routes outside the caller's supported inventory, including removed services under the [removal contract](reconciliation-and-deployments.md#removal); an incomplete inventory must not be passed as complete desired routing. Calls without a snapshot verify the persisted endpoints. Verification failures remain uncertain and retryable.

- Resources within a service communicate directly using resource names, such as `store:5432`.
- Resources in different services have no direct service-network connectivity; explicitly published host ports are reachable according to host routing and firewall rules.
- Envoy connects to each service network and routes inter-service traffic.
- Workload ports are published only when explicitly configured with `hostPorts`.
- Envoy’s external ingress ports provide platform-managed HTTP ingress.

Envoy uses separate external and internal listeners. The internal listener, administration interface, and configuration interfaces must not be externally accessible.

No authentication or authorization is enforced for internal communication. All workloads are therefore treated as trusted peers.

The control plane's private metrics listener uses port 9090 and the `control-plane.paas.internal` service-network alias. It has no published host port or Envoy route. See the [metrics collection contract](../services/metrics/README.md#built-in-dashboards-and-application-metrics) for scraping and labels.

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

Every web or static resource, including a sole implicit primary, has this external URL:

```text
https://{resourceId}.{serviceId}.{baseDomain}
```

The [primary resource](configuration.md#service-descriptors), selected across web and static resources together, also receives `https://{serviceId}.{baseDomain}`. Both hostnames route to the same resource and use its authentication policy. Other resources retain independent endpoints and policies. Local deployments without TLS use the same names over HTTP; nonstandard ingress ports appear in URLs.

Static routes use a DNS cluster targeting `paas:8081`, the control plane's dedicated static HTTP listener on the bootstrap network. Envoy applies the same fail-closed ingress authorization as for web routes. The static listener has no published host port, management API, health or OAuth routes. It resolves only published static resource hosts and their primary aliases. No service Docker network or workload container is created for static-only services. This listener follows the same trusted internal-network boundary as workload ports.

Static serving supports GET and HEAD, preserves binary contents, assigns MIME types by extension, and serves `index.html` for `/` and directory paths ending in `/`. Missing files return 404; there is no SPA fallback, directory listing or WebSocket upgrade. Paths are decoded once and traversal, NUL bytes, backslashes and symbolic links are rejected. Responses use `Cache-Control: no-cache` and `X-Content-Type-Options: nosniff`. Static resource policy applies to every file; see [static configuration](configuration.md#static-resources).

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

### Workload WebSockets

Web ingress supports WebSocket upgrades on resource hostnames and primary service aliases. HTTPS upgrades use the same fail-closed authorization check as ordinary HTTP requests: private ingress requires a valid platform session, public ingress follows its declared public policy, and platform cookies are stripped before forwarding to workloads. Local HTTP development retains its existing unauthenticated public-only policy. Other upgrade protocols remain disabled; management upgrades remain restricted to `/api/ui/live`.

Only WebSocket requests disable the route request timeout; ordinary HTTP requests retain their existing timeouts. Workload sockets have a five-minute stream idle timeout, reset by traffic in either direction, so applications should send heartbeats when idle. Upgrades retain Envoy's normal HTTP filter chain, including authorization; no alternate filter chain bypasses authentication.

Platform authorization is checked only at the initial handshake. Session expiry or allowlist removal does not terminate established workload sockets; reconnecting requires a fresh authorization check. Applications own origin validation, message authorization and any ongoing session checks. Connections stay with their original container until closed, including during deployments; applications must reconnect after interruption. This differs from the management socket's continuous session revalidation.

### GitHub login and JWT sessions

The control plane implements GitHub OAuth login. A configured GitHub user allowlist determines who may create a session. `AuthService` derives the callback URL from the configured ingress domain and HTTPS port and supplies the same URL to the provider for authorization and token exchange. See [configuration](configuration.md#implemented-deployment-mvp) for the derived URL to register with GitHub.

After successful login, the platform issues a local JWT session using secure, HTTP-only cookies. It validates the signature, issuer, audience, and expiration on subsequent requests.

GitHub is contacted during login, not for each application request.

Login must work across service hostnames without exposing platform session tokens to hosted applications.

Envoy's HTTPS listener performs HTTP `ext_authz` checks against the private control-plane `/auth/check` prefix for every application request, including public ingress. The control plane reads the persisted routing policy, validates sessions locally, and replaces the upstream `Cookie` header with only application cookies. Platform cookies are stripped for both public and private applications; other application credentials are preserved. Unknown services are denied and authorization errors fail closed.

Private requests without a valid session redirect to `https://auth.{baseDomain}/oauth/github/login`, preserving the original URL in validated OAuth state. Only login and `/auth/callback` are routed to the control plane on that hostname; the authorization endpoint and management paths are never exposed there. Login targets must use a configured service hostname, a resource hostname within a configured service, or the [management UI's base hostname](management-ui.md), with the configured HTTPS port. Authorization still requires an actual published endpoint for resource requests. Signed, ten-minute OAuth state is bound to a random browser nonce in a host-only, secure, HTTP-only cookie and cleared on callback. The GitHub username allowlist is checked before issuing a session and on session validation.

Sessions use the secure, HTTP-only `__Secure-paas_session` cookie scoped to the base domain with `SameSite=Lax`; Envoy removes it before proxying to workloads. JWTs use HS256 with required signature, issuer, audience, purpose, and expiration validation. OAuth state and session tokens have distinct purposes. Application-provided duplicate platform cookies do not authenticate a request. GitHub access tokens are used only during login and are never stored in session cookies. There is no service-specific allowlist or administrator role in the current contract.

Public ingress is the compatibility option for applications whose native clients cannot complete platform login.

## Ingress access logs

Every external HTTP connection manager, including HTTP redirects and HTTPS ingress, writes structured JSON access logs to Envoy stdout. Records include `component: ingress`, start time, method, host, path without query, final response status, duration in milliseconds, upstream cluster, response flags and response-code details. They exclude cookies, authorization headers, response headers, request bodies and query strings. The upstream cluster identifies the selected workload; requests rejected before upstream selection may have none. These records describe the actual ingress response; control-plane `/auth/check` records describe only the authorization decision. WebSocket access records normally complete when the connection closes.

The management UI exposes the redacted Envoy container tail under [Cluster → Ingress logs](management-ui.md). PaaS logs remains the control-plane stream. Authorization-check log severity and retained metrics follow the [backend logging contract](development.md#backend-logging).

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

The production ACME account key persists at `_paas/acme-account.pem`. A base-domain wildcard does not cover nested resource names, so each configured service receives its own wildcard SAN. DigitalOcean zone discovery selects the longest managed suffix of each challenged name; challenge records are tracked individually and cleanup removes only records created for that challenge. The certificate chain and matching private key are validated before atomic replacement of `_paas/envoy/ingress.pem`. `_paas/envoy/sds.yaml` references that combined PEM; filesystem SDS watches its directory and reloads Envoy's TLS context on replacement. Private material uses mode `0600` within the platform state directory. Envoy's host mount is restricted to this generated directory; see the [filesystem layout](architecture.md#configuration-and-filesystem-layout). ACME issuance limits still apply; provisioning errors retain full operator diagnostics and never silently omit required names.

Startup checks the actual persisted certificate SANs and provisions missing coverage, including certificates issued before resource hostnames were supported, before publishing the HTTPS listener. Coverage and expiry checks then run every sixty seconds and renew with fewer than thirty days remaining or when configured service additions require new wildcard SANs. Removing a service does not force renewal. A renewal failure retains an existing usable certificate; startup fails if no usable certificate exists. Names absent from the retained certificate remain unusable over verified TLS until issuance succeeds. HTTPS port publication remains an operator/bootstrap responsibility; the local Compose fixture publishes loopback ports 80 and 443 for `local.maxine4j.com`.

DNS records pointing the base domain, service and authentication hostnames, and nested resource hostnames (or per-service wildcard records) at the Docker host are an operator prerequisite. Certificate DNS-01 automation creates challenge TXT records only; application DNS remains operator-managed.

See [configuration](configuration.md) for complete platform and service examples and [reconciliation and deployments](reconciliation-and-deployments.md) for routing changes during rollout.
