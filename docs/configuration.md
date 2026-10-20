# Configuration

Platform and service configuration contracts, including defaults and complete examples. See [architecture](architecture.md) for the host filesystem layout.

All platform and descriptor YAML is parsed through the canonical backend YAML utility. Syntax errors, duplicate keys, unresolved tags and other parser warnings fail validation; failures never include source excerpts or credential values. See [development](development.md#backend-infrastructure-boundaries) for the implementation boundary.

## Implemented deployment MVP

The current runtime supports exactly one `web` resource per service, one replica, and `recreate` or `surge` deployment. Descriptors use the schema below with only `version`, `metadata`, and `resources` at the top level. Runtime-supported web fields are `type`, `image`, `ingress`, optional `replicas: 1`, `rolloutStrategy` (`recreate` or `surge`), `healthcheckUrl`, `command`, literal `env` values, and `termination.timeoutSeconds` (default 30, maximum 300). Unknown fields fail descriptor validation; unsupported runtime features fail a separate capability check before changing workloads. The public TypeScript types, Zod schema, and `parseDescriptor` validator in `@homelab-paas/shared-contracts` describe the complete service descriptor contract below. Platform configuration, runtime capability checks, and deployment state stay in the backend.

Workers, managed databases/brokers, secret references, volumes, limits, egress, and multiple replicas are deferred. Private ingress (including the default `public: false`) requires platform auth and TLS. Without them, ingress must explicitly set `public: true`. The remaining service examples include capabilities beyond the deployed runtime.

At startup, supplied environment variables override the corresponding YAML fields before validation:

| Environment variable     | YAML field                     |
| ------------------------ | ------------------------------ |
| `GITHUB_CLIENT_ID`       | `auth.github.clientId`         |
| `GITHUB_CLIENT_SECRET`   | `auth.github.clientSecret`     |
| `SESSION_SIGNING_KEY`    | `auth.session.signingKey`      |
| `DIGITALOCEAN_API_TOKEN` | `tls.dns.credentials.apiToken` |
| `ACME_EMAIL`             | `tls.acme.email`               |

Unset variables preserve YAML values; empty overrides fail validation when their section is configured. Environment credentials alone do not enable authentication or TLS. The YAML must still contain the corresponding sections, GitHub allowlist and session settings. Keep local credentials in the ignored Compose `.env` file; see [development](development.md#local-container-environment).

Platform configuration contains `version: 1`, `metadata.clusterId`, `ingress.baseDomain`, optional `ingress.httpPort` (default 80), `git`, `reconciliation`, and `services`. The `auth` and `tls` sections shown below are optional together; supplying only one fails startup. With both enabled, `ingress.httpsPort` defaults to 443 and HTTP redirects to HTTPS. HTTP and HTTPS ports must differ. Without auth/TLS, `httpsPort` is rejected and public HTTP remains available for local development. Git credentials remain deferred. Polling, operation timeout, and retry bounds are required positive integer seconds. Restart the control plane to apply platform configuration changes.

GitHub client ID, client secret, and a nonempty username allowlist are required when authentication is enabled. Username matching is case-insensitive. `AuthService` derives the callback as `https://auth.{baseDomain}/auth/callback`, including `:{httpsPort}` for a nonstandard HTTPS port; `callbackUrl` is not a configurable field. Register this derived URL in the GitHub OAuth application. The service ID `auth` is reserved in this mode. Session issuer, audience, signing key (at least 32 characters), and positive integer lifetime in seconds are required. TLS requires an ACME email and DigitalOcean API token; provider selection is fixed to `digitalocean`. Certificate paths, production ACME directory, and renewal timing are platform-owned; see [TLS](networking-and-auth.md#tls).

For normal remotes, `branch` defaults to `main` and `descriptorPath` defaults to `{serviceId}.sd.yaml` relative to the repository root. Git fetches the configured branch into platform-owned repositories and reads the descriptor at its resolved commit.

The magic remote `local` reads an existing Git repository on the control-plane container's filesystem. It requires an absolute `descriptorPath`; the enclosing repository is discovered with Git. An omitted branch means the mounted repository's `HEAD`, including its currently checked-out branch. An explicit branch selects that local ref. Descriptors are always read with `git show` at a resolved commit; uncommitted edits are ignored. This mode does not fetch or read the YAML directly from the working tree.

```yaml
version: 1
metadata:
    clusterId: local
ingress:
    baseDomain: localhost
    httpPort: 80
git:
    pollIntervalSeconds: 5
    operationTimeoutSeconds: 60
reconciliation:
    retryBackoffSeconds: 5
    maxRetryBackoffSeconds: 60
services:
    test-service:
        remote: local
        descriptorPath: /mnt/repo/services/test-service/test-service.sd.yaml
```

## Service descriptors

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

Resources are a discriminated union of `web`, `worker`, `postgres`, and `rabbitmq`. Every resource requires a nonempty `image` and may set `limits` and `termination.timeoutSeconds` (positive integer seconds, maximum 300). Web and worker resources additionally accept `command`, `env`, `volumes`, `egress`, positive integer `replicas` (default 1), and `rolloutStrategy` (`recreate` by default, or `surge`). Web resources require an ingress port (1–65535), default `ingress.public` to `false`, and default `healthcheckUrl` to `/healthcheck`. Workers have no ingress or configurable health check. Managed PostgreSQL and RabbitMQ resources accept no custom environment, credentials, volumes, replicas, or rollout strategy; see [managed resources](managed-resources.md).

## Environment variables and secrets

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

## Volumes and resource limits

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

## Example platform configuration

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

## Example service descriptor

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

See [networking and authentication](networking-and-auth.md) for ingress and egress behaviour, [reconciliation and deployments](reconciliation-and-deployments.md) for rollout and health-check fields, and [managed resources](managed-resources.md) for generated connection variables.
