# Architecture

These documents define the intended platform. Existing code may still need to be aligned with these requirements.

## Overview

homelab-paas is a single-host platform for running microservices and self-hosted applications such as Jellyfin.

The stack consists of:

- Docker Engine for containers, networks, and storage mounts.
- Envoy for external ingress, inter-service routing, and load balancing.
- A single TypeScript/Node.js control-plane container.

The control plane manages Git reconciliation, Docker resources, Envoy configuration, GitHub authentication, JWT sessions, managed resource credentials, and TLS certificates. It also serves the [management UI and API](management-ui.md), whose dedicated Koa router delegates aggregation to an injected frontend service. Platform configuration edits and secret-redaction rules belong to the configuration service.

The Docker client exposes low-level network, container, and image operations through platform-owned types. It validates Engine responses and translates failures into sanitized typed errors. Inspection returns absence explicitly; callers decide whether missing resources are acceptable. The Docker service owns platform labels, naming, image resolution, and service-scoped container and network helpers. Container queries include stopped containers and validate deployment identity labels. Lifecycle operations verify ownership; stopping or removing an absent container succeeds. Service-network preparation validates the cluster's control-plane and Envoy identities before creating or attaching resources. Reconcilers use these helpers to observe actual state and compare it with the descriptor's desired state. `ReconcilerService` fetches committed descriptors through the Git service, validates them, and delegates to resource reconcilers. `start.ts` composes these layers with deployment strategies and networking. Reconciliation and management inspection share the [three-tier Git cache](reconciliation-and-deployments.md#shared-git-cache); remote refresh and health/retry reconciliation run on independent schedules.

Docker Compose bootstraps Envoy and the control plane for [local development](development.md#local-container-environment) and [production deployment](../prod/README.md). The platform manages application workloads directly through Docker Engine.

Independent health and management inspection share an injected backend [runtime observation component](reconciliation-and-deployments.md#shared-runtime-observations). Deployment and ownership operations keep fresh Docker observations. The [reconciliation scheduler and desired-input cache](reconciliation-and-deployments.md#targeted-scheduling-and-desired-inputs) serialize affected services and recover persisted retry deadlines without periodic healthy-service deployment passes. Management/observational change notifications remain separate from desired-input scheduling, so updating a snapshot cannot request a deployment.

One [Docker event watcher and serialized safety audit](reconciliation-and-deployments.md#docker-events-and-safety-audit) feed the scheduler through invalidation hints. The stream connects before initial inventory; reconnect and periodic audits recover missed events without blocking consumption. Live mutable settings remain independently observed through platform-owned Docker types.

## Initial scope

The platform supports:

- Git-managed service descriptors.
- Web, static, worker, PostgreSQL, and RabbitMQ resources.
- Authenticated or public HTTP ingress.
- Inter-service HTTP communication through Envoy.
- Recreate and surge deployments.
- Multiple web or worker replicas.
- Persistent host storage.
- Simple explicit host device mappings and numeric supplementary groups; see [devices](configuration.md#devices-and-supplementary-groups).
- Explicit TCP and UDP host ports for web and worker applications; see the [host-port contract](configuration.md#host-ports).

The initial version excludes multi-host scheduling, internal authorization, backups, disaster recovery, automated database upgrades, and cross-service database or broker endpoints.

## Configuration and filesystem layout

The platform reads its configuration from:

```text
/etc/homelab-paas/config.yaml
```

Host paths:

| Path                                                         | Purpose                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `/etc/homelab-paas/config.yaml`                              | Platform configuration and credentials               |
| `/etc/homelab-paas/env/{serviceId}.env`                      | User-managed service secrets                         |
| `/var/homelab-paas/{serviceId}/{resourceId}/`                | Platform-managed resource storage                    |
| `/var/homelab-paas/{serviceId}/volumes/`                     | Named and resource-scoped application volume storage |
| `/var/homelab-paas/{serviceId}/{resourceId}/credentials.env` | Platform-generated resource credentials              |
| `/var/homelab-paas/_paas/`                                   | Platform state and ACME account material             |
| `/var/homelab-paas/_paas/envoy/`                             | Generated Envoy bootstrap, discovery and TLS files   |
| `/var/homelab-paas/_paas/envoy/ingress.pem`                  | TLS certificate chain and private key                |
| `/var/homelab-paas/_paas/static/{serviceId}/{resourceId}/`   | Published static bundle files                        |

The control-plane container mounts the Docker socket and the required configuration and state directories. Paths supplied to Docker for bind mounts refer to the **host filesystem**.

`_paas` is the only internal state namespace. Its generated artifacts are subject to [six-hour cleanup](reconciliation-and-deployments.md#docker-disk-cleanup); application data and credentials are retained. Envoy mounts only `_paas/envoy/`, read-only. Its generated `envoy.yaml` bootstrap, `cds.yaml`, `lds.yaml`, `sds.yaml` and `ingress.pem` all live there; the ACME account key remains outside that mount at `_paas/acme-account.pem`. Startup generates the bootstrap before reporting the control plane healthy. There is no filesystem migration or legacy read fallback.

Application volumes support generated resource-scoped storage, service-scoped named storage, and explicit absolute Docker host paths. See [configuration](configuration.md#volumes-and-resource-limits) for path resolution, mount semantics and operator responsibilities.

Configuration and credential files must have restricted permissions. Secrets must not appear in status responses. Operator logs retain full failure diagnostics under the [backend logging contract](development.md#backend-logging).

See [configuration](configuration.md) for input formats, [networking and authentication](networking-and-auth.md) for traffic and identity, [reconciliation and deployments](reconciliation-and-deployments.md) for lifecycle behaviour, and [managed resources](managed-resources.md) for database and broker presets.
