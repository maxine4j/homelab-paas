# Networking and authentication

The [deployment MVP](configuration.md#implemented-deployment-mvp) exposes public HTTP at `http://{serviceId}.{baseDomain}:{httpPort}` (port 80 by default). It has no authentication, TLS, internal listener, or inter-service discovery. The control plane and Envoy attach to each service's dedicated Docker network; workloads publish no host ports. Bootstrap containers must carry `homelab-paas.cluster={clusterId}` and `homelab-paas.role=control-plane` or `envoy` labels so the control plane can discover them. Envoy loads generated filesystem xDS from the shared platform state directory. Its administration/configuration interfaces have no published ports. The remaining sections describe the complete intended platform.

## Networking

The reconciler uses `INetworkingService.routeTo` to switch a ready service endpoint and `withdraw` to stop assigning new requests before container retirement. `NetworkingService` serializes updates across services and records desired endpoints in its injected endpoints store before publication. Failed or uncertain publication retains that desired state for retry; callers must retain containers that may receive traffic. Startup supplies `FileReconciliationStore` for persistent endpoints; the in-memory implementation remains available for tests.

`EnvoyService` converts plain endpoint values into public HTTP routing and health-check configuration. `EnvoyClient` serializes filesystem xDS, waits for active CDS resources before publishing LDS, and confirms active listeners through the private admin `/config_dump` API with bounded polling, including retries while the admin API starts. Unchanged resources may retain earlier per-resource versions; acceptance checks the discovery version, active resource identities, and absence of warming replacements. `NodeEnvoyTransport` owns atomic discovery-file replacement and bounded admin HTTP I/O. Startup uses the shared platform state directory and `http://envoy:9901` for private admin access, with 30 acceptance attempts one second apart and a two-second HTTP timeout. `bootstrap.ts` creates the state directory and seeds missing discovery files before the control-plane health server starts so Envoy can start before route acceptance is checked. Existing discovery files and persisted state are preserved. Authentication, TLS, and the internal listener remain deferred in this implementation.

Each service receives a dedicated Docker network.

- Resources within a service communicate directly using resource names, such as `store:5432`.
- Resources in different services cannot communicate directly.
- Envoy connects to each service network and routes inter-service traffic.
- Workload ports are not published on the host.
- Only Envoy’s external ingress ports are published.

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

External service URLs follow:

```text
https://{serviceId}.{baseDomain}
```

Web resources declare their application port and authentication policy:

```yaml
ingress:
    public: false
    port: 3000
```

`public` defaults to `false`.

Every external application request passes through Envoy’s authorization check against the control plane:

- Private ingress requires a valid platform JWT session.
- Public ingress allows access without a platform session.
- Applications using public ingress manage their own authentication where required.
- Authorization-check failures fail closed.

Login and OAuth callback routes are exempt from requiring an existing session.

### GitHub login and JWT sessions

The control plane implements GitHub OAuth login. A configured GitHub user allowlist determines who may create a session.

After successful login, the platform issues a local JWT session using secure, HTTP-only cookies. It validates the signature, issuer, audience, and expiration on subsequent requests.

GitHub is contacted during login, not for each application request.

Login must work across service hostnames without exposing platform session tokens to hosted applications.

Public ingress is the compatibility option for applications whose native clients cannot complete platform login.

## TLS

The control plane provisions and renews one Let’s Encrypt wildcard certificate for:

```text
*.{baseDomain}
```

Validation uses DNS-01. **DigitalOcean is the only supported DNS provider in v1.**

The platform owns certificate paths, ACME account storage, renewal timing, and Envoy certificate updates. These are not configurable.

Renewal must update Envoy without restarting workloads. Renewal failures retain the current certificate and report an error.

DNS records pointing service and authentication hostnames at the Docker host are an operator prerequisite.

See [configuration](configuration.md) for complete platform and service examples and [reconciliation and deployments](reconciliation-and-deployments.md) for routing changes during rollout.
