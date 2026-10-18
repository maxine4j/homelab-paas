# CP-34 — Verify stateful recovery procedures

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Prove resource-specific backup/restore and supported stateful updates using documented procedures.

## Dependencies

[CP-29](../m5/CP-29-postgres-bindings.md), [CP-31](../m5/CP-31-rabbitmq-bindings.md), [CP-33](../m5/CP-33-ferretdb-bindings.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)
- [platform spec](../../platform-spec.md)

## Scope

- Document consistent PostgreSQL, RabbitMQ, and agreed FerretDB/backend backup/restore with required credentials and metadata.
- Exercise supported upgrades and rejected incompatible transitions; state expected interruption and pre-upgrade backup requirements.
- Restore representative resources and their controller identity from backups and verify consumer connectivity/data.

## Acceptance criteria

- [ ] Procedures do not describe raw live database-directory copying as a consistent backup.
- [ ] Restored data, credentials, ownership, and binding identity remain coherent after reconciliation.
- [ ] Scheduling/remote destinations and automatic database major upgrades are not implied; downgrade limits are explicit.

## Verification

Run explicit resource recovery/update drills with real data and interrupted restore cases; record commands, expected results, limitations, and evidence. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
