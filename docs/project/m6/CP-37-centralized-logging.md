# CP-37 — Provision centralized logging

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Collect workload and platform logs centrally with bounded storage and protected access.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-22](../m4/CP-22-reconciliation-engine.md), [CP-26](../m4/CP-26-source-lifecycle.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [configuration and storage](../../configuration-and-storage.md)
- [frontend](../../frontend.md)

## Scope

- Reconcile pinned Loki and a maintained log collector with resource budgets, persistent storage, retention, and network intent.
- Attach service/resource/revision identity to stdout/stderr from web, worker, dependencies, and platform workloads.
- Provide administrator-protected supported log access/link contracts and redact secret-bearing platform telemetry.

## Decisions to resolve

Choose the maintained collector and record pinned versions, budgets, and retention defaults. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Logs survive the agreed component restart/retention behavior and can be attributed across workload revisions.
- [ ] Missing collection/delivery failures are actionable rather than silently reported healthy.
- [ ] Log endpoints do not expose secrets through platform-generated URLs/headers or permit unauthenticated management access.

## Verification

Exercise end-to-end log delivery for each workload type, collector/Loki outage and recovery, retention settings, attribution, and authorized access. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
