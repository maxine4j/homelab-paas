# CP-39 — Implement Pushgateway integration

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Support explicit short-lived job metrics with authenticated writers and reliable retirement cleanup.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-26](../m4/CP-26-source-lifecycle.md), [CP-36](../m6/CP-36-metrics-infrastructure.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Provision pinned internal Pushgateway with budgets and a concrete writer authorization mechanism.
- Define explicit supported job/resource opt-in, stable grouping keys, and required network grants.
- Persist cleanup intent and remove stale groups on job/resource retirement with retry/restart recovery.

## Decisions to resolve

Agree writer authorization, suitable job integration, grouping identity, and lifecycle signals within the existing resource model; do not invent a new job product without owner agreement. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Undeclared/unrelated writers cannot push metrics or delete other resources' groups.
- [ ] Retired groups disappear after recoverable cleanup, including controller restart or gateway outage.
- [ ] Long-running web/worker health stays pull-based; Pushgateway is not a log/event store.

## Verification

Exercise allowed/denied writes, group ownership, cleanup after retirement, outage/restart, and no unintended public ingress. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
