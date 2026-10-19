# Architecture

These documents define the intended platform. Existing code may still need to be aligned with these requirements.

## Overview

homelab-paas is a single-host platform for running microservices and self-hosted applications such as Jellyfin.

The stack consists of:

- Docker Engine for containers, networks, and storage mounts.
- Envoy for external ingress, inter-service routing, and load balancing.
- A single TypeScript/Node.js control-plane container.

The control plane manages Git reconciliation, Docker resources, Envoy configuration, GitHub authentication, JWT sessions, managed resource credentials, and TLS certificates.

Docker Compose is not used.

## Initial scope

The platform supports:

- Git-managed service descriptors.
- Web, worker, PostgreSQL, and RabbitMQ resources.
- Authenticated or public HTTP ingress.
- Inter-service HTTP communication through Envoy.
- Recreate and surge deployments.
- Multiple web or worker replicas.
- Persistent host storage.

The initial version excludes multi-host scheduling, internal authorization, backups, disaster recovery, automated database upgrades, and cross-service database or broker endpoints.

## Configuration and filesystem layout

The platform reads its configuration from:

```text
/etc/homelab-paas/config.yaml
```

Host paths:

| Path                                                         | Purpose                                  |
| ------------------------------------------------------------ | ---------------------------------------- |
| `/etc/homelab-paas/config.yaml`                              | Platform configuration and credentials   |
| `/etc/homelab-paas/env/{serviceId}.env`                      | User-managed service secrets             |
| `/var/homelab-paas/{serviceId}/{resourceId}/`                | Persistent resource storage              |
| `/var/homelab-paas/{serviceId}/{resourceId}/credentials.env` | Platform-generated resource credentials  |
| `/var/homelab-paas/_paas/`                                   | Platform state and ACME account material |
| `/var/homelab-paas/_paas/ingress.pem`                        | TLS certificate chain and private key    |

The control-plane container mounts the Docker socket and the required configuration and state directories. Paths supplied to Docker for bind mounts refer to the **host filesystem**.

Configuration and credential files must have restricted permissions. Secrets must not appear in logs or status responses.

See [configuration](configuration.md) for input formats, [networking and authentication](networking-and-auth.md) for traffic and identity, [reconciliation and deployments](reconciliation-and-deployments.md) for lifecycle behaviour, and [managed resources](managed-resources.md) for database and broker presets.
