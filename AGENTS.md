# homelab-paas requirements

## 1. Overview

homelab-paas is a single-host platform for running microservices and self-hosted applications such as Jellyfin.

The stack consists of:

- Docker Engine for containers, networks, and storage mounts.
- Envoy for external ingress, inter-service routing, and load balancing.
- A single TypeScript/Node.js control-plane container.

The control plane manages Git reconciliation, Docker resources, Envoy configuration, GitHub authentication, JWT sessions, managed resource credentials, and TLS certificates.

Docker Compose is not used.

## 2. Initial scope

The platform supports:

- Git-managed service descriptors.
- Web, worker, PostgreSQL, and RabbitMQ resources.
- Authenticated or public HTTP ingress.
- Inter-service HTTP communication through Envoy.
- Recreate and surge deployments.
- Multiple web or worker replicas.
- Persistent host storage.

The initial version excludes multi-host scheduling, internal authorization, backups, disaster recovery, automated database upgrades, and cross-service database or broker endpoints.

## 3. Configuration and filesystem layout

The platform reads its configuration from:

```text
/etc/homelab-paas/config.yaml
```

Host paths:

| Path | Purpose |
|---|---|
| `/etc/homelab-paas/config.yaml` | Platform configuration and credentials |
| `/etc/homelab-paas/env/{serviceId}.env` | User-managed service secrets |
| `/var/homelab-paas/{serviceId}/{resourceId}/` | Persistent resource storage |
| `/var/homelab-paas/{serviceId}/{resourceId}/credentials.env` | Platform-generated resource credentials |
| `/var/homelab-paas/_paas/` | Platform state and ACME account material |
| `/var/homelab-paas/_paas/ingress.pem` | TLS certificate chain and private key |

The control-plane container mounts the Docker socket and the required configuration and state directories. Paths supplied to Docker for bind mounts refer to the **host filesystem**.

Configuration and credential files must have restricted permissions. Secrets must not appear in logs or status responses.

## 4. Service descriptors

Each configured service has a descriptor named:

```text
{serviceId}.sd.yaml
```

The filename and repository path may be overridden in the platform configuration.

A service groups related resources—for example, an application, worker, database, and queue.

Service and resource IDs must use lowercase kebab case:

```text
^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
```

The descriptor’s `metadata.serviceId` must match its key in the platform configuration.

Each service may contain at most one web resource.

## 5. Networking

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

## 6. External ingress and authentication

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

## 7. Deployments

Web and worker resources support:

```yaml
rolloutStrategy: recreate
```

`recreate` is the default.

| Strategy | Behaviour |
|---|---|
| `recreate` | Stop existing containers before starting replacements. Downtime is expected. |
| `surge` | Start replacements alongside existing containers, establish readiness, then retire the previous revision. |

PostgreSQL and RabbitMQ always use recreate deployment.

Surge requires sufficient spare capacity and an application that tolerates overlapping instances. For workers, this includes tolerating concurrent execution across revisions.

### Web rollout sequence

For a surge deployment, the platform:

1. Pulls the required image.
2. Starts replacement containers.
3. Waits for successful readiness checks.
4. Updates Envoy and confirms configuration acceptance.
5. Stops assigning new requests to the previous revision.
6. Drains existing requests within the termination timeout.
7. Stops and removes the previous containers.

If replacement readiness fails, the previous revision remains active.

For recreate deployments, the previous containers are stopped first. A failed replacement is reported and retried; uninterrupted availability is not guaranteed.

### Replicas and load balancing

Web and worker resources may specify `replicas`, defaulting to `1`.

Envoy distributes web traffic across ready replicas. Worker replicas run independently and require application-level coordination where necessary.

A stable service URL remains unchanged as containers are replaced.

## 8. Health checks and termination

Web resources accept:

```yaml
healthcheckUrl: /healthcheck
```

This defaults to `/healthcheck`, relative to the configured application port. HTTP `200–299` indicates readiness.

Health-check timing, startup allowance, and failure thresholds are managed by the platform.

Only ready web containers receive Envoy traffic.

Workers have no configurable readiness check in v1. A running worker container establishes process startup, not application readiness. PostgreSQL and RabbitMQ use platform-managed health checks.

Resources may configure graceful termination:

```yaml
termination:
  timeoutSeconds: 60
```

When omitted, the platform uses its default timeout. Containers receive a graceful stop signal, followed by forced termination if the timeout expires. Web request draining shares this bounded shutdown period.

The platform does not guarantee uninterrupted long-lived streams or connections during deployment.

## 9. Git reconciliation

Each configured repository is checked every configured polling interval.

The platform fetches the configured branch and reads the descriptor from a specific commit. The entire descriptor is validated before changes are applied.

The reconciler must:

- Run at startup, on polling intervals, and after relevant Docker lifecycle events.
- Compare desired configuration with actual managed resources.
- Recover stopped or missing containers.
- Serialize deployments within each service.
- Label Docker objects with service, resource, and revision identities.
- Persist deployment state so interrupted operations can resume safely.
- Retry failed operations with bounded backoff.
- Expose desired revision, active revision, deployment phase, and actionable errors.

Git failures and invalid descriptors preserve the last working deployment.

### Container updates and images

Existing containers should be updated in place where Docker supports the change safely. Changes to images, environment variables, commands, or mounts generally require replacement.

Images are pulled when first creating a resource or deploying a changed image reference. Container creation uses the resolved local image identity.

Periodic detection of changed content behind an unchanged image tag is not required. Image tagging policy belongs to each service.

### Removal

Removing a resource stops and removes its containers. Removing a service stops and removes all its resource containers.

Persistent data and generated credentials are retained.

Reverting the Git change recreates the resource using retained storage and credentials. Compatibility between retained data and the restored image remains the operator’s responsibility.

## 10. Environment variables and secrets

Web and worker resources may declare literal values or secret references:

```yaml
env:
  - name: FOO
    value: "123"
  - name: EXTERNAL_API_TOKEN
    secret: true
```

Literal values must be strings.

Secret references resolve by variable name from:

```text
/etc/homelab-paas/env/{serviceId}.env
```

Missing required secrets fail deployment without disrupting an existing working revision.

Secret-file changes are reconciled even when Git has not changed. Containers are replaced when necessary to apply changed environment variables.

Platform-generated environment-variable names are reserved. Conflicting user declarations fail validation.

## 11. Volumes and resource limits

Web and worker resources may declare persistent volumes:

```yaml
volumes:
  - source: app/uploads
    target: /app/uploads
    readOnly: false
```

`source` is relative to `/var/homelab-paas/{serviceId}/`. Absolute source paths and path traversal are rejected. Volume data is retained after resource removal.

Resources may declare CPU and memory limits:

```yaml
limits:
  cpus: 1
  memoryMiB: 512
```

These limits are applied through Docker Engine.

## 12. Managed PostgreSQL and RabbitMQ

PostgreSQL and RabbitMQ are simple container presets with explicit image versions.

The platform automatically:

- Creates persistent storage under the resource directory.
- Generates administrator credentials on first creation.
- Stores credentials in the resource’s `credentials.env` file.
- Configures the database or broker container.
- Injects connection variables into every web and worker container within the service.
- Performs resource-specific health checks.

Descriptors do not accept custom credentials or volumes for these resource types in v1.

Credentials are generated once and reused across reconciliation, replacement, and removal/recreation. Missing credentials alongside existing data must fail deployment rather than silently generating replacements.

### Injected connection variables

For a PostgreSQL resource named `store`:

```dotenv
PAAS_RESOURCE_STORE_HOST=store
PAAS_RESOURCE_STORE_PORT=5432
PAAS_RESOURCE_STORE_DATABASE=example
PAAS_RESOURCE_STORE_USERNAME=<generated>
PAAS_RESOURCE_STORE_PASSWORD=<generated>
```

The initial database name is derived deterministically from the service ID.

For a RabbitMQ resource named `queue`:

```dotenv
PAAS_RESOURCE_QUEUE_HOST=queue
PAAS_RESOURCE_QUEUE_PORT=5672
PAAS_RESOURCE_QUEUE_USERNAME=<generated>
PAAS_RESOURCE_QUEUE_PASSWORD=<generated>
```

Applications must consume these variables or map them to their own configuration.

These presets do not provide backups, replication, automatic credential rotation, or automated major-version upgrades.

## 13. TLS

The control plane provisions and renews one Let’s Encrypt wildcard certificate for:

```text
*.{baseDomain}
```

Validation uses DNS-01. **DigitalOcean is the only supported DNS provider in v1.**

The platform owns certificate paths, ACME account storage, renewal timing, and Envoy certificate updates. These are not configurable.

Renewal must update Envoy without restarting workloads. Renewal failures retain the current certificate and report an error.

DNS records pointing service and authentication hostnames at the Docker host are an operator prerequisite.

## 14. Example platform configuration

```yaml
version: 1

metadata:
  clusterId: prod

ingress:
  baseDomain: apps.example.com
  httpPort: 80
  httpsPort: 443

auth:
  github:
    clientId: replace-me
    clientSecret: replace-me
    callbackUrl: https://auth.apps.example.com/oauth/github/callback
    allowedUsers:
      - your-github-username

  session:
    issuer: homelab-paas
    audience: homelab-paas
    signingKey: replace-with-a-long-random-secret
    ttlSeconds: 43200

git:
  pollIntervalSeconds: 120
  operationTimeoutSeconds: 60

reconciliation:
  retryBackoffSeconds: 10
  maxRetryBackoffSeconds: 300

tls:
  acme:
    email: admin@example.com
  dns:
    provider: digitalocean
    credentials:
      apiToken: replace-me

services:
  example:
    remote: git@github.com:example/example.git
    branch: main
    descriptorPath: example.sd.yaml
    credentials:
      sshPrivateKeyPath: /etc/homelab-paas/git/id_ed25519
      knownHostsPath: /etc/homelab-paas/git/known_hosts

  another-service:
    remote: https://github.com/example/another-service.git
    # branch defaults to main
    # descriptorPath defaults to another-service.sd.yaml
```

## 15. Example service descriptor

```yaml
# example.sd.yaml
version: 1

metadata:
  serviceId: example
  description: A web application, worker, database, and queue
  labels:
    owner: homelab

resources:
  app:
    type: web
    image: ghcr.io/example/app:1.0.0
    replicas: 1
    rolloutStrategy: surge

    ingress:
      public: false
      port: 3000

    healthcheckUrl: /healthcheck # optional; this is the default

    termination:
      timeoutSeconds: 60

    egress:
      - another-service

    env:
      - name: FOO
        value: "123"
      - name: EXTERNAL_API_TOKEN
        secret: true

    volumes:
      - source: app/uploads
        target: /app/uploads
        readOnly: false

    limits:
      cpus: 1
      memoryMiB: 512

  worker:
    type: worker
    image: ghcr.io/example/app:1.0.0
    command:
      - node
      - dist/worker.js
    rolloutStrategy: recreate

    egress:
      - another-service

    termination:
      timeoutSeconds: 60

    limits:
      cpus: 0.5
      memoryMiB: 256

  store:
    type: postgres
    image: postgres:17

    limits:
      cpus: 1
      memoryMiB: 1024

  queue:
    type: rabbitmq
    image: rabbitmq:4

    limits:
      cpus: 0.5
      memoryMiB: 512
```

The corresponding user-managed secret file contains only application secrets:

```dotenv
# /etc/homelab-paas/env/example.env
EXTERNAL_API_TOKEN=replace-me
```

Database and broker credentials are generated, persisted, and injected automatically.
