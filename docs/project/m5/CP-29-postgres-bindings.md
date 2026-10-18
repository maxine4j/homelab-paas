# CP-29 — Implement PostgreSQL consumer bindings

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Give application consumers only their declared PostgreSQL permissions and credentials.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-28](../m5/CP-28-postgres-lifecycle.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement typed binding-to-database/role provisioning with stable scoped credentials and explicit environment/file mappings.
- Generate exact network grants and inject secrets only into entitled consumers after provisioning.
- Implement idempotent role/database reconciliation and explain binding retirement without silently deleting retained data.

## Acceptance criteria

- [ ] Reconcile/restart reuses scoped identities and does not grant administrative credentials to consumers.
- [ ] Declared permissions succeed while unrelated consumers/databases remain inaccessible.
- [ ] Partial provisioning and credential publication retry safely; secret values remain redacted.

## Verification

Test concurrent/repeated provisioning, crash recovery, positive/negative database permissions, network boundaries, and nonstandard environment mappings. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

