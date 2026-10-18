# Reconciliation and workload operations

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing plans, Kubernetes resources, deployment strategies, network policy, managed-resource lifecycle, or observability.

Read related requirements only when the change crosses those boundaries: [descriptors](descriptors.md), [GitOps](gitops.md), [configuration and storage](configuration-and-storage.md), [access and ingress](access-and-ingress.md).

## Kubernetes reconciliation

- Separate parsing, validation/defaulting, planning, mutation, and observation.
- Use the maintained Tokio-compatible `kube` Rust client/runtime rather than parsing `kubectl` output for core reconciliation.
- Use one namespace per enrolled service, with separate reserved platform and observability namespaces. Descriptors cannot select namespaces. Persist namespace allocation/name and naming algorithm/version before creation, validate DNS limits/collisions before enrollment, and record returned UID after observation. Keep service namespaces on ordinary removal.
- Persist accepted desired state, inventory, and operation/finalization progress in the versioned atomic YAML snapshot `_platform/state/controller.yaml`, protected by the lifetime lock at `_platform/state/controller.lock`. No CRDs or custom-resource finalizers; future CRD use requires a new architecture decision. Follow the [configuration and storage](configuration-and-storage.md) commit, migration, and singleton protocols; no SQLite or additional metadata database server.
- Watch observed Kubernetes state and run periodic resynchronization. Reconcile after controller restarts without requiring a new Git commit.
- Use idempotent operations, bounded queues, per-service serialization, retry backoff, and explicit operation deadlines.
- Apply only platform-owned objects/fields. Surface conflicting manual changes; do not silently seize unrelated resources.
- Establish required secrets, storage, policies, and dependencies before exposing workloads.
- Provision default-deny policy before launching application pods. Permit only required bootstrap/infrastructure traffic and declared connections.
- Ensure ownership cleanup cannot cascade into persistent data deletion. Finalization and failure recovery must be restart-safe.
- Track observed generation/revision and conditions such as Accepted, Reconciling, Ready, Degraded, and Deleting, with actionable reasons.
- A control-plane crash midway through provisioning must leave enough persisted identity/inventory to resume without duplicate resources or new credentials.

### Durable effects and restart recovery

- Commit stable target identities, object ownership tokens, desired generations, and pending operation intents before creating Kubernetes objects, paths, credentials, or dependency-side resources. Use deterministic names/idempotency keys where supported. The durable pending set, not the in-memory queue, is the source for restart scheduling.
- Effects follow durable intent → bounded idempotent effect → durable observation/result. Inspect uncertain outcomes before retrying. Record returned UIDs/resource versions and completion only after observation; a failed result commit leaves the existing intent pending. Keep accepted/applied/healthy revisions distinct and advance only on their verified conditions.
- Pause new external mutations on any durable-write failure or indeterminate commit. Already in-flight effects may finish; recover them from previously committed intents. Never report unrecorded progress as durably successful.
- After restart, validate metadata and installation/cluster binding under the lifetime lock, refresh live observations, and resume pending operations. Do not reconstruct approvals from Kubernetes or regenerate identities/credentials when state is missing or corrupt.

### Object, label, and field ownership

- Reserve the `homelab-paas.io/` metadata prefix for installation, service, resource (where applicable), and stable object ownership IDs; revision/generation are diagnostic metadata. Descriptor labels cannot override it. Labels select and corroborate objects but never independently authorize adoption or deletion.
- Inventory records target cluster, API group/resource, namespace/name, expected kind/version, returned UID, enrollment/service/resource identity, ownership token, desired generation, field manager, and lifecycle class (`runtime` or `retained`). Namespace inventory has no namespace; cluster-scoped objects require explicit platform inventory. Pending creates have a persisted target/token but no fabricated UID.
- Create absent targets using create requests carrying the durable ownership token. An existing target is a conflict unless its recorded UID/ownership match. Recover an interrupted create by binding its observed UID only when the exact token and durable pending-create intent match. A racing foreign create remains a conflict; apply cannot adopt unknown objects.
- Bootstrap must explicitly persist/handoff its initial platform object ownership. Names and labels alone do not authorize reconciliation to seize existing objects.
- Update verified owned objects with server-side apply, a stable platform field manager, and `force: false`. Manage generated specification/reserved metadata only; leave status, allocated fields, and other managers' fields alone. Surface manual intent changes, field-manager conflicts, or concurrent replacement with target/field diagnostics; never force ownership transfer or silently overwrite conflicting edits.
- Owner references belong only within disposable runtime hierarchies (for example Deployment → ReplicaSet → Pod). Retained storage/credential objects cannot depend on disposable owners, and services cannot depend on the controller Pod's lifetime.

### Removal and retained inventory

- Only explicit authorized removal or descriptor absence in a complete successfully fetched enrolled revision permits runtime pruning. Source errors, invalid desired state, incomplete scans, and discovery omissions do not.
- Commit deletion intent with exact inventory targets before effects. Verify current ownership and delete runtime objects with UID/resource-version preconditions. Changed UID, metadata mismatch, or unexpected dependents are conflicts, not grounds for broader deletion. Record observed absence before completing inventory transitions; inspect pending deletes after timeouts/restart.
- Never use selector-wide cleanup or ordinary namespace/root-directory deletion. Retain service namespaces, data directories, credential files, aliases, PVs/PVCs, tombstones, and identity/path reservations. Set PV reclaim policy explicitly to `Retain`; avoid owner-reference/provisioning cascades into retained state. Unknown dependencies block potentially cascading cleanup until diagnosed.
- Destructive purge is a separate administrator-authorized operation over exact retained identities with active-resource protection and durable progress. Ordinary reconciliation cannot call it. Re-enrollment/reuse policy is not implied by retained inventory.

## Deployment and availability semantics

- `rolling` is supported for applications that tolerate overlapping instances. Use readiness/startup probes, graceful shutdown, traffic draining, spare capacity, and an explicit progress deadline.
- For compatible single-replica web apps, default rolling parameters can be `maxUnavailable: 0`, `maxSurge: 1`. A second steady-state replica is not required for an application rollout.
- `recreate` is required for single-writer or otherwise overlap-incompatible workloads. Make expected interruption visible before deployment.
- Worker rollout behaviour must account for duplicate execution, acknowledgements, and consumer shutdown. A running process is not proof of safe job completion.
- Database schema migrations need explicit compatibility and ordering. Do not automatically reverse or rerun arbitrary migrations.
- Failed new workloads should preserve healthy old capacity where the chosen strategy permits. Surface rollout failure and retain diagnosis; specify rollback policy rather than assuming Kubernetes rolls back automatically.
- Do not claim uninterrupted connections for indefinite streams, automatic continuity through stateful upgrades, or availability during host/appliance restarts.
- The control plane is also the auth decision service. Its unavailability denies protected traffic; never bypass authentication to keep applications reachable.

## Network permissions

- Implement service-to-service reachability with Kubernetes NetworkPolicy, initially using K3s' supported policy enforcement.
- Default deny application ingress and egress, with generated grants for DNS, necessary platform services, and explicitly declared dependencies/call relationships.
- A binding grants only its declared destination and protocol/port. Corresponding credentials provide application-level authorization where supported.
- Web routing grants ingress from Traefik. Monitoring grants scraping from the observability namespace. Pushgateway grants are explicit where enabled.
- External internet access is an explicit policy decision per resource/profile; avoid broad egress rules that inadvertently allow private cluster/LAN destinations.
- Do not claim L7 authorization, mTLS identity, or isolation from a hostile host administrator. Those are outside the initial network-policy contract.
- Test enforcement on the actual nested K3s runtime, including denied connections and permitted infrastructure paths.

## Centralized observability

- Provision Prometheus, Loki, Grafana, Alertmanager, Pushgateway, and a maintained log collector as platform-managed Kubernetes workloads.
- Prefer a simple single-instance deployment of each component initially. Set explicit resource budgets, persistent directories, retention, and disk limits.
- Collect stdout/stderr logs from web, worker, managed-resource, and platform containers; attach service/resource/revision labels and send them to Loki.
- Scrape container resource usage and Kubernetes workload state for all resources. Use the correct workload identity; nested-node metrics do not automatically represent the whole physical host.
- Scrape Traefik for HTTP traffic and the control plane for Git polling, reconciliation, authentication availability, certificate renewal, and provisioning metrics.
- Scrape application endpoints when declared and supported. Provision supported dependency exporters automatically. Show unsupported/unconfigured application metrics explicitly rather than fabricating coverage.
- Supply Prometheus discovery/scrape configuration centrally; users do not write annotations or monitoring charts.
- Pushgateway supports appropriate service-level batch/job metrics. Long-running web/worker health and metrics remain pull-based.
- Isolate Pushgateway internally, authorize writers, use stable grouping keys, and remove stale groups on job/resource retirement. Do not use it as a general log/event store.
- Generate Grafana data sources, common dashboards, and default alerts. Protect platform monitoring UIs with GitHub authentication and the administrator list.
- Cover failed polls, stalled rollouts, crash loops, missing scrapes, low disk, dependency failure, and certificate expiry with default alert rules.
- Alertmanager routes notifications only to explicitly configured receivers. No configured receiver means visible local alert status, not successful external notification.
- Bound label cardinality and redact secret-bearing URLs/headers. Do not expose tokens, credentials, or sensitive descriptor contents in telemetry.

## Required verification

- Integration tests: Kubernetes ownership/reconciliation, restart recovery, stable credentials, conflicting configuration, Git failure handling, certificate retry/publication, and auth sessions/forwarded-header trust.

- Exercise healthy rolling deployment and a failed new deployment while continuously issuing HTTP requests. Verify the promised availability only for the supported workload profile.

- Exercise descriptor deletion, source-scope removal, repository rename/transfer, default-branch changes, invalid revisions, missing repositories, interrupted provisioning, full/unwritable storage, and restoration from a documented backup. Discovery omissions and permission failures must never trigger workload/data deletion.

## Reference documentation

- [K3s networking services](https://docs.k3s.io/networking/networking-services)
- [Rust Kubernetes client/runtime](https://docs.rs/kube/latest/kube/)
- [Kubernetes deployment semantics](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Prometheus Pushgateway guidance](https://prometheus.io/docs/practices/pushing/)
