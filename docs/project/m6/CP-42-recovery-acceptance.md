# CP-42 — Complete control-plane recovery acceptance

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Demonstrate integrated control-plane recovery and record the boundary of the evidence.

## Dependencies

[CP-34](../m5/CP-34-stateful-recovery.md), [CP-35](../m6/CP-35-operations-api.md), [CP-40](../m6/CP-40-dashboards-and-alerts.md), [CP-41](../m6/CP-41-retained-data-purge.md).

## Read first

- [platform spec](../../platform-spec.md)
- [reconciliation](../../reconciliation.md)
- [gitops](../../gitops.md)
- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Add explicit integration acceptance scenarios spanning discovery, approval, polling, resource provisioning, access, certificates, observability, and recovery.
- Inject controller crashes, storage errors, Git/provider outages, invalid desired revisions, and interrupted provisioning/cleanup.
- Restore documented backups and verify stable credentials/identity, retained data, inventory, conditions, and working consumers.

## Acceptance criteria

- [ ] Failures preserve the last accepted application state and never deploy an unapproved discovery.
- [ ] Auth remains fail-closed; certificate renewal failure preserves the valid certificate; interrupted work resumes without duplicated identity.
- [ ] Results document which scenarios used doubles, real k3d, or production nested K3s; missing production appliance acceptance remains explicit.

## Verification

Run the explicit integrated suite and backup/restore drills; record evidence and unresolved limitations. Privileged Linux appliance tests remain separate and cannot be inferred from local k3d results. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
