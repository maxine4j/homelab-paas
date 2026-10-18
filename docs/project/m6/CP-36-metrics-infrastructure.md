# CP-36 — Provision metrics infrastructure

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Provision bounded metrics collection for platform operations and all managed workload identities.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-22](../m4/CP-22-reconciliation-engine.md), [CP-26](../m4/CP-26-source-lifecycle.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [configuration and storage](../../configuration-and-storage.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Reconcile pinned Prometheus and maintained Kubernetes/container metrics collectors as platform-owned workloads.
- Configure budgets, persistent paths, retention/disk bounds, scrape discovery, network grants, and owned cleanup.
- Instrument/scrape control-plane polling, reconciliation, auth availability, provisioning, certificates, and Traefik without unbounded labels.

## Decisions to resolve

Record component versions, budgets, and retention defaults before provisioning; avoid inferring whole-host visibility. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] All resource types have platform-level workload metrics tied to correct identity.
- [ ] Nested-node metrics are not presented as whole-host coverage; absent/stale scrapes are visible.
- [ ] Restart preserves configured monitoring state and storage limits; labels/URLs never disclose credentials.

## Verification

Run explicit metrics-stack integration, scrape failure/recovery, retention/resource configuration checks, and telemetry redaction/cardinality tests. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
