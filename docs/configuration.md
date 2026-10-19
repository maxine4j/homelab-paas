# Configuration

Platform and service configuration contracts, including defaults and complete examples. See [architecture](architecture.md) for the host filesystem layout.

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
