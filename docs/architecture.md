# Architecture

These documents define the intended platform. Existing code may still need to be aligned with these requirements.

## Overview

homelab-paas is a single-host platform for running microservices and self-hosted applications such as Jellyfin.

The stack consists of:

- Docker Engine for containers, networks, and storage mounts.
- Envoy for external ingress, inter-service routing, and load balancing.
- A single TypeScript/Node.js control-plane container.

The control plane manages Git reconciliation, Docker resources, Envoy configuration, GitHub authentication, JWT sessions, managed resource credentials, and TLS certificates. It also serves the [read-only management UI and API](management-ui.md), whose dedicated Koa router delegates aggregation to an injected frontend service.

The Docker client exposes low-level network, container, and image operations through platform-owned types. It validates Engine responses and translates failures into sanitized typed errors. Inspection returns absence explicitly; callers decide whether missing resources are acceptable. The Docker service owns platform labels, naming, image resolution, and service-scoped container and network helpers. Container queries include stopped containers and validate deployment identity labels. Lifecycle operations verify ownership; stopping or removing an absent container succeeds. Service-network preparation validates the cluster's control-plane and Envoy identities before creating or attaching resources. Reconcilers use these helpers to observe actual state and compare it with the descriptor's desired state. `ReconcilerService` fetches committed descriptors through the Git service, validates them, and delegates to resource reconcilers. `start.ts` composes these layers with deployment strategies and networking; a periodic reconciler task runs immediately and on each polling interval.

Docker Compose bootstraps Envoy and the control plane for [local development](development.md#local-container-environment) and [production deployment](../prod/README.md). The platform manages application workloads directly through Docker Engine.

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
| `/var/homelab-paas/{serviceId}/{resourceId}/`                | Platform-managed resource storage        |
| `/var/homelab-paas/{serviceId}/{resourceId}/credentials.env` | Platform-generated resource credentials  |
| `/var/homelab-paas/_paas/`                                   | Platform state and ACME account material |
| `/var/homelab-paas/_paas/ingress.pem`                        | TLS certificate chain and private key    |

The control-plane container mounts the Docker socket and the required configuration and state directories. Paths supplied to Docker for bind mounts refer to the **host filesystem**.

Application volumes may bind arbitrary absolute Docker host paths using `hostPath` and `mountPath`; they are not confined to the platform-managed storage directory. See [configuration](configuration.md#volumes-and-resource-limits) for mount semantics and operator responsibilities.

Configuration and credential files must have restricted permissions. Secrets must not appear in logs or status responses.

See [configuration](configuration.md) for input formats, [networking and authentication](networking-and-auth.md) for traffic and identity, [reconciliation and deployments](reconciliation-and-deployments.md) for lifecycle behaviour, and [managed resources](managed-resources.md) for database and broker presets.
