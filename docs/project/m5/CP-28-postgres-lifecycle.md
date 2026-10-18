# CP-28 — Implement PostgreSQL lifecycle

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Provision a persistent PostgreSQL instance with repeatable initialization and stable identity.

## Dependencies

[CP-20](../m4/CP-20-storage-and-secrets.md), [CP-22](../m4/CP-22-reconciliation-engine.md), [CP-27](../m5/CP-27-managed-resource-profiles.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement pinned PostgreSQL workload, service, persistent paths, restrictive network intent, probes, resource budgets, and lifecycle conditions.
- Persist administrative credentials once and make initialization/retry detect existing state safely.
- Enable the implemented profile only when storage, credential, and retained-removal behavior is complete; provide baseline backup/restore and supported-version documentation.

## Acceptance criteria

- [ ] Restart, redeploy, and interrupted initialization preserve data and administrative credentials.
- [ ] Runtime removal retains data/credentials and does not silently initialize a new database over an existing identity.
- [ ] Unsupported/incompatible upgrades are rejected with actionable diagnostics; readiness represents usable database service.

## Verification

Run explicit PostgreSQL initialization/restart/redeployment, interrupted provisioning, retained deletion, and persistent-data checks. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
