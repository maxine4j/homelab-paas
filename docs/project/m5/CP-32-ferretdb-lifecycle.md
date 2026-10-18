# CP-32 — Implement FerretDB lifecycle

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Provision the agreed FerretDB/backend combination as one managed resource lifecycle.

## Dependencies

[CP-20](../m4/CP-20-storage-and-secrets.md), [CP-22](../m4/CP-22-reconciliation-engine.md), [CP-27](../m5/CP-27-managed-resource-profiles.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement pinned backend and FerretDB workloads, ordered prerequisites, storage, internal connectivity, credentials, and health.
- Reuse PostgreSQL lifecycle support where compatible with the approved backend; do not introduce an arbitrary alternative backend.
- Document version compatibility, retained removal, baseline backup/restore, and supported update transitions.

## Decisions to resolve

CP-27 chooses the backend; record any additional dependency on CP-28 after that choice, before scheduling implementation. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] FerretDB readiness reflects backend availability; partial provisioning resumes without new credentials or duplicate backends.
- [ ] Application/resource restart preserves data and component identity.
- [ ] Incompatible combinations are rejected before mutation; removal retains all required backend data and credentials.

## Verification

Exercise backend outage/recovery, interrupted component provisioning, persistent restart, retained deletion, and compatibility rejection. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
