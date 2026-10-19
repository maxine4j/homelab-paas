# Networking and authentication

## Networking

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
