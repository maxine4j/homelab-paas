# Control-plane milestones

Status: proposed implementation roadmap. This plan does not override the binding specifications or settle decisions identified below.

Scope: the Rust control plane, shared contracts, management APIs, and provisioning of supporting workloads. SPA screens, the outer appliance, systemd, and publication are separate workstreams. The starting implementation provides health checks, static serving, logging, and HTTP shutdown.

Individual ticket files are linked in the Ticket column and grouped under `m1/` through `m6/`. Each ticket is intended as one PR. Include relevant tests, documentation, contracts/examples, and Bazel integration in that PR. Future agents should change `[ ]` to `[x]` in the Done column only when the ticket's scope and acceptance criteria are complete. Add the implementing PR link to the ticket cell when available. Split a ticket before implementation if it cannot remain independently reviewable.

## Milestone 1 — Configuration, contracts, and durable state

Outcome: the backend can load validated host configuration, inspect descriptors, and recover its own state.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [x] | [CP-01](m1/CP-01-persistence-and-ownership-adr.md) | **Record persistence and ownership decisions.** Accepted: atomic YAML snapshot, lifetime OS file lock, one namespace per service, no CRDs. Requirements incorporated into binding guides; [ADR](../adr/0001-controller-persistence-and-ownership.md) retains rationale. |
| [x] | [CP-02](m1/CP-02-shared-contracts.md) | **Introduce shared contracts and generation.** Canonical Rust configuration/API/error models; JSON Schema export and Bazel-generated TypeScript. No parallel handwritten wire models. |
| [ ] | [CP-03](m1/CP-03-host-configuration.md) | **Implement host configuration and secret references.** Validate bootstrap requirements and independent access/discovery scopes; redact secrets; produce actionable local errors. Invalid configuration leaves management unavailable. |
| [ ] | [CP-04](m1/CP-04-controller-persistence.md) | **Implement controller persistence.** Versioned records, migrations, atomic durable writes, and recovery tests for interrupted writes and full/unwritable storage. |
| [ ] | [CP-05](m1/CP-05-web-worker-descriptors.md) | **Define and implement web/worker descriptors.** Versioned parsing, defaults, references, IDs, routes, permissions, storage declarations, and redacted previews. Reject duplicate/unknown fields and unsupported resource types. |
| [ ] | [CP-06](m1/CP-06-application-runtime.md) | **Establish the application runtime.** Shared clients, bounded background tasks, cancellation, deadlines, structured operation logging, and separate liveness/readiness semantics. Add outbound HTTPS trust roots to the image. |

Persistence/ownership decisions are settled in the binding guides. Decisions still needed: concrete descriptor fields/defaults. Resolve the configuration guide's `organization` versus YAML `org` inconsistency before implementing discovery-owner parsing.

## Milestone 2 — Secure management access

Outcome: valid host configuration produces HTTPS and administrator login; protected requests fail closed.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [ ] | [CP-07](m2/CP-07-session-trust-adr.md) | **Record session and trust-boundary design.** Decide application session exchange, trusted Traefik requests, session persistence/expiry, and configuration reload/revocation behavior. Avoid a broad parent-domain cookie. |
| [ ] | [CP-08](m2/CP-08-acme-dns-issuance.md) | **Implement ACME issuance and DigitalOcean DNS-01.** Persist account/order state; handle propagation, retries, challenge cleanup, and restart recovery using protocol test doubles. |
| [ ] | [CP-09](m2/CP-09-certificate-renewal.md) | **Implement certificate publication and renewal.** Validate and publish key/chain together; retain the valid certificate during failures; expose expiry/renewal status. Gate login on initial valid HTTPS. |
| [ ] | [CP-10](m2/CP-10-github-login-sessions.md) | **Implement GitHub login, callback, sessions, and logout.** State, PKCE, server-side token exchange, verified user identity, safe return URLs, and persisted signing material. |
| [ ] | [CP-11](m2/CP-11-management-authorization.md) | **Enforce management authorization and mutation protection.** Independent administrator policy on every management API; CSRF/origin checks; existing sessions lose access after allowlist removal. |
| [ ] | [CP-12](m2/CP-12-route-forward-auth.md) | **Implement route authorization and ingress integration.** Platform-owned route registry, private forward-auth endpoint, spoofed-header rejection, private-app policy, and explicit public bypass. |
| [ ] | [CP-13](m2/CP-13-configuration-api.md) | **Add authenticated configuration APIs.** Secret-redacted reads and validated atomic host-file updates, with concurrent-edit protection and the agreed reload behavior. |

Exit test: private-app-only and admin-only users have their respective permissions; neither inherits the other. OAuth/provider/control-plane failures never bypass protection.

## Milestone 3 — Read-only discovery and inspection

Outcome: administrators can inspect complete or partial discovery results and review an exact descriptor revision. Discovery has no provisioning effects.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [ ] | [CP-14](m3/CP-14-github-repository-enumeration.md) | **Implement GitHub repository enumeration.** User/organization pagination, private-repository coverage, immutable repository identity, owner filtering, rate limits, and scoped failures. |
| [ ] | [CP-15](m3/CP-15-immutable-descriptor-discovery.md) | **Implement immutable descriptor discovery.** Resolve default-branch commits; inspect regular root-level `*.sd.yaml` files only; enforce size limits; report malformed candidates individually. |
| [ ] | [CP-16](m3/CP-16-candidate-state.md) | **Persist candidates and scan decisions.** Deduplicate scans; retain timestamps, revision metadata, diagnostics, and ignore decisions; incomplete scans cannot imply deletion. |
| [ ] | [CP-17](m3/CP-17-discovery-review-api.md) | **Expose discovery and review APIs.** Paginated candidates, scan status/rescan, ignore operations, and exact-revision previews of resources, routes, storage, and permissions. |

Acceptance arrives in milestone 4 with the deployment path, so an accepted service has a meaningful operational lifecycle.

## Milestone 4 — Web/worker deployment and continuous reconciliation

Outcome: an administrator accepts one reviewed descriptor; the platform deploys it and safely follows subsequent Git changes.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [ ] | [CP-18](m4/CP-18-kubernetes-adapter.md) | **Implement the Kubernetes adapter and development prerequisites.** Reused `kube` client, ownership checks, watches, scoped RBAC, configuration/state mounts, and explicit local integration targets. |
| [ ] | [CP-19](m4/CP-19-kubernetes-planning.md) | **Implement pure Kubernetes planning.** Deterministic web/worker plans, route/resource conflicts, dependency ordering, ownership metadata, and redacted plan output before mutation. |
| [ ] | [CP-20](m4/CP-20-storage-and-secrets.md) | **Implement safe storage and secret materialization.** Contained paths, symlink/traversal rejection, configured aliases, supported volume/file types, scoped secret references, and stable generated credentials. |
| [ ] | [CP-21](m4/CP-21-network-policy.md) | **Implement network-policy generation.** Default deny before pods; precise DNS, ingress, monitoring, and dependency grants. Record external-egress semantics before enabling that feature. |
| [ ] | [CP-22](m4/CP-22-reconciliation-engine.md) | **Implement the reconciliation engine.** Durable desired state/inventory, bounded queue, per-service serialization, idempotent apply, retries, watches/resync, conditions, and crash recovery. |
| [ ] | [CP-23](m4/CP-23-web-worker-lifecycle.md) | **Implement web/worker lifecycle.** Services, routes, probes, image-digest recording, graceful shutdown, rolling/recreate strategies, and actionable rollout failure. Decide failure/rollback policy explicitly. |
| [ ] | [CP-24](m4/CP-24-administrator-acceptance.md) | **Implement durable administrator acceptance.** Revalidate the reviewed revision and full plan; reject stale/conflicting requests; persist approval before enqueueing; make concurrent/repeated acceptance idempotent. |
| [ ] | [CP-25](m4/CP-25-enrolled-source-polling.md) | **Implement enrolled-source polling.** Deploy the reviewed revision first, then track the pinned branch/path; distinguish fetched, accepted, applied, and healthy revisions. Invalid/unreachable sources retain the last valid deployment. |
| [ ] | [CP-26](m4/CP-26-source-lifecycle.md) | **Implement source lifecycle and retained deletion.** Stop tracking, explicit rebind, rename/transfer/scope handling, and deletion from a complete fetched revision. Prune owned runtime objects while retaining data/credentials. |

Exit tests: discovery never deploys; new unapproved files stay unapproved; controller restart resumes reconciliation; failed compatible rolling updates preserve old healthy capacity. Real K3s tests verify permitted and denied connections.

## Milestone 5 — Managed dependencies and stateful applications

Outcome: all five initial resource types work with stable credentials, typed bindings, retained data, and documented recovery.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [ ] | [CP-27](m5/CP-27-managed-resource-profiles.md) | **Define managed-resource profiles and contracts.** Decide supported versions, FerretDB/backend combination, defaults, binding permissions, credential scopes, and supported upgrade boundaries. |
| [ ] | [CP-28](m5/CP-28-postgres-lifecycle.md) | **Implement PostgreSQL lifecycle.** Pinned workload, initialization, persistence, health, stable administrative credentials, and retention on removal. |
| [ ] | [CP-29](m5/CP-29-postgres-bindings.md) | **Implement PostgreSQL consumer bindings.** Scoped application roles/databases, explicit environment mappings, network grants, and restart-safe provisioning. |
| [ ] | [CP-30](m5/CP-30-rabbitmq-lifecycle.md) | **Implement RabbitMQ lifecycle.** Persistent broker, initialization, stable credentials, health, and private opt-in management ingress. |
| [ ] | [CP-31](m5/CP-31-rabbitmq-bindings.md) | **Implement RabbitMQ consumer bindings.** Scoped users/vhosts/permissions, connection mappings, and restart-safe updates. |
| [ ] | [CP-32](m5/CP-32-ferretdb-lifecycle.md) | **Implement FerretDB lifecycle.** Agreed backend combination, ordered component provisioning, persistence, health, and supported version transitions. |
| [ ] | [CP-33](m5/CP-33-ferretdb-bindings.md) | **Implement FerretDB consumer bindings.** Scoped credentials, connection mappings, entitlement checks, and restart-safe provisioning. |
| [ ] | [CP-34](m5/CP-34-stateful-recovery.md) | **Verify stateful recovery procedures.** Document and exercise resource-appropriate backup/restore and supported upgrades, including credential and controller metadata recovery. |

Stateful testing belongs in each resource PR; CP-34 verifies the documented recovery procedures together. Database upgrades must not inherit web-app availability promises.

## Milestone 6 — Operations and recovery

Outcome: administrators can diagnose failures, operate services safely, and recover the platform's managed state.

| Done | Ticket | PR scope and acceptance |
| --- | --- | --- |
| [ ] | [CP-35](m6/CP-35-operations-api.md) | **Expose operational management APIs.** Service/resource topology, conditions, revision history, digests, storage, certificate status, sync requests, and supported restart operations. Keep declared topology distinct from observations. |
| [ ] | [CP-36](m6/CP-36-metrics-infrastructure.md) | **Provision metrics infrastructure.** Pinned Prometheus, Kubernetes/container collectors, resource budgets, persistent storage, retention, discovery, and control-plane/Traefik metrics. |
| [ ] | [CP-37](m6/CP-37-centralized-logging.md) | **Provision centralized logging.** Loki and maintained collector, bounded storage, service/resource/revision labels, and secret-safe log access. |
| [ ] | [CP-38](m6/CP-38-resource-metrics.md) | **Integrate application and dependency metrics.** Declared scrape endpoints and supported exporters; report unsupported/unconfigured coverage explicitly. |
| [ ] | [CP-39](m6/CP-39-pushgateway-integration.md) | **Implement Pushgateway integration.** Explicit writer permissions, stable grouping keys, and stale-group cleanup on retirement. |
| [ ] | [CP-40](m6/CP-40-dashboards-and-alerts.md) | **Provision dashboards and alerts.** Grafana, Alertmanager, administrator-protected routes, default dashboards/alerts, and explicitly configured receivers. |
| [ ] | [CP-41](m6/CP-41-retained-data-purge.md) | **Implement explicit retained-data purge.** Separate administrator operation with clear targets, active-resource protection, durable progress, and restart recovery. Ordinary reconciliation never invokes it. |
| [ ] | [CP-42](m6/CP-42-recovery-acceptance.md) | **Complete control-plane recovery acceptance.** Exercise interrupted reconciliation, storage failures, source failures, credential stability, backup restoration, auth denial, and certificate renewal failure across the integrated system. |

The observability components are supporting workloads; their provisioning and lifecycle belong to this control-plane plan.

## Sequencing and verification

- Primary sequence: milestone 1 → 2 → 3 → 4 → 5 → 6. Discovery implementation can proceed after milestone 1 while access work continues, but its APIs remain administrator-only.
- Resolve decisions with the owner and record them before dependent implementation. Requirements already settled by the specifications remain settled.
- Certificate publication and ingress in milestone 2 include the minimum Kubernetes client/RBAC/mount integration; CP-18 reuses and extends it rather than delaying HTTPS until milestone 4.
- CP-01 precedes CP-04; CP-07 precedes session/trust implementation; CP-18–CP-23 provide the deployment path required by CP-24; CP-27 precedes managed-resource implementation.
- Add instrumentation and operational read endpoints alongside features; milestone 6 completes their integration.
- Every implementation ticket includes relevant failure/restart tests, updated contracts/examples, and applicable Bazel checks (`bazel build //:check`, `bazel test //...`, and relevant service targets).
- Kubernetes integration tests stay explicit. Production nested-runtime acceptance remains a separate appliance dependency; local k3d results do not establish production appliance guarantees.
- Initial recommended commitment: milestones 1–4 establish configure → authenticate → discover → approve → deploy → update before expanding lifecycle complexity across databases and monitoring.

## Binding specifications

- [Platform scope and architecture](../platform-spec.md)
- [Service descriptor contracts](../descriptors.md)
- [GitHub discovery, enrollment, and tracking](../gitops.md)
- [Reconciliation and workload operations](../reconciliation.md)
- [Access, ingress, and certificates](../access-and-ingress.md)
- [Configuration, state, secrets, and storage](../configuration-and-storage.md)
- [Frontend and management API](../frontend.md)
- [Build tooling, CI, and image packaging](../build-and-ci.md)
