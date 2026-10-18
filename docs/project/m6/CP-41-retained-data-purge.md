# CP-41 — Implement explicit retained-data purge

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Delete retained data only through a distinct explicit administrator operation.

## Dependencies

[CP-11](../m2/CP-11-management-authorization.md), [CP-20](../m4/CP-20-storage-and-secrets.md), [CP-26](../m4/CP-26-source-lifecycle.md), [CP-35](../m6/CP-35-operations-api.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)
- [frontend](../../frontend.md)

## Scope

- Define a precise preview/target contract for retained resource data and generated credentials, separate from stop/removal.
- Implement active-resource/identity validation, administrator mutation protection, durable progress, and restart-safe deletion.
- Report retained/purging/purged/failed states and preserve unrelated service/platform paths.

## Decisions to resolve

Agree explicit administrator confirmation/target semantics and how retained credentials relate to purge before enabling destructive behavior. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Ordinary reconciliation, descriptor deletion, discovery, and source failure cannot invoke purge.
- [ ] Active-resource and stale-target requests are rejected; retries do not broaden deletion targets.
- [ ] Partial deletion/restart remains diagnosable and bounded to authorized contained paths.

## Verification

Test unauthorized/stale/active targets, path/symlink attacks, repeated requests, interrupted deletion, and unrelated data preservation. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
