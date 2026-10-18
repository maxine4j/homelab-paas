# CP-26 — Implement source lifecycle and retained deletion

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Handle explicit source changes and proven descriptor removal without losing retained identity or data.

## Dependencies

[CP-25](../m4/CP-25-enrolled-source-polling.md).

## Read first

- [gitops](../../gitops.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement durable stop-tracking and administrator source rebind decisions preserving the intended existing service identity.
- Handle repository rename, owner transfer/scope removal, lost access, and default-branch changes with explicit pause/source status.
- Prune only owned runtime objects after proven removal from a complete fetched tracked revision; retain data and generated credentials.
- Persist exact deletion targets, verify inventory ownership and UID/resource-version preconditions, and resume pending deletes by observation after restart. Never delete service namespaces or resource roots during ordinary cleanup; retain PVs/PVCs, tombstones, and identity/path reservations. Unexpected dependents block potentially cascading deletion; different sources cannot silently acquire retained state.

## Decisions to resolve

Record any unresolved stop/resume/rebind operational semantics; do not equate stopping polling with destructive removal. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Missing repositories/branches, permission failures, discovery omissions, or owner removal never prune deployed resources.
- [ ] Rescan/restart never automatically re-enrolls stopped sources or silently adopts a moved descriptor.
- [ ] Confirmed deletion and interrupted finalization are restart-safe and cannot cascade into data/credential deletion.

## Verification

Exercise path moves/rebinds, rename/transfer, scope removal, missing branches, complete descriptor deletion, stop persistence, and interrupted cleanup. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
