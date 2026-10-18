# Reconciliation and workload operations

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing plans, Kubernetes resources, deployment strategies, network policy, managed-resource lifecycle, or observability.

Read related requirements only when the change crosses those boundaries: [descriptors](descriptors.md), [GitOps](gitops.md), [configuration and storage](configuration-and-storage.md), [access and ingress](access-and-ingress.md).

## Kubernetes reconciliation

- Separate parsing, validation/defaulting, planning, mutation, and observation.
- Use the maintained Tokio-compatible `kube` Rust client/runtime rather than parsing `kubectl` output for core reconciliation.
- Recommended model: one namespace per service with resource labels; persist accepted desired state and ownership metadata in a versioned controller store. Custom Kubernetes CRDs are optional, not a prerequisite for being operator-style.
- Decide the controller store and any CRD use in an ADR before implementing persistence. Avoid adding a second database server for control-plane metadata.
- Watch observed Kubernetes state and run periodic resynchronization. Reconcile after controller restarts without requiring a new Git commit.
- Use idempotent operations, bounded queues, per-service serialization, retry backoff, and explicit operation deadlines.
- Apply only platform-owned objects/fields. Surface conflicting manual changes; do not silently seize unrelated resources.
- Establish required secrets, storage, policies, and dependencies before exposing workloads.
- Provision default-deny policy before launching application pods. Permit only required bootstrap/infrastructure traffic and declared connections.
- Ensure ownership cleanup cannot cascade into persistent data deletion. Finalization and failure recovery must be restart-safe.
- Track observed generation/revision and conditions such as Accepted, Reconciling, Ready, Degraded, and Deleting, with actionable reasons.
- A control-plane crash midway through provisioning must leave enough persisted identity/inventory to resume without duplicate resources or new credentials.

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
