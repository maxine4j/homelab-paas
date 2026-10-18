# CP-25 — Implement enrolled-source polling

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Continuously update only enrolled branch/path sources while preserving the last valid desired state.

## Dependencies

[CP-24](../m4/CP-24-administrator-acceptance.md).

## Read first

- [gitops](../../gitops.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Poll enrolled immutable repository identities and pinned branch/path sources using stable commit snapshots and bounded scheduling.
- Validate complete enrolled-service desired state before accepting updates; record fetched, accepted, applied, and healthy revisions separately.
- Support authenticated immediate poll requests and backoff/rate-limit diagnostics without discovery-based deployment authority.

## Decisions to resolve

Record poll timing/backoff bounds; the specified sixty-second interval is a recommendation. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Fetch/auth/validation failures preserve running desired state and never trigger deletion.
- [ ] New unapproved files or invalid unrelated descriptors do not block an enrolled descriptor's valid updates.
- [ ] Controller restart resumes polling and reconciliation without a new commit; default-branch changes never silently switch tracking.

## Verification

Test invalid revisions, unreachable sources, partial fetches, new unapproved files, restart, pinned branches, and revision transitions. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
