# CP-16 — Persist candidates and scan decisions

Milestone: [M3](../_milestones.md) · Status: Not started · PR: —

Make candidate history, scan completeness, and explicit ignore decisions survive restarts.

## Dependencies

[CP-04](../m1/CP-04-controller-persistence.md), [CP-15](../m3/CP-15-immutable-descriptor-discovery.md).

## Read first

- [gitops](../../gitops.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Persist candidate identity and revision metadata, validation status, discovery timestamps, scan outcomes, and ignore decisions.
- Deduplicate repeated/overlapping scans and schedule bounded jittered discovery with retry/rate-limit handling.
- Represent incomplete scans and stale observations without treating them as authoritative deletion.

## Decisions to resolve

Record the discovery interval and limits; the specified five-minute interval is a recommendation, not an automatic requirement. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Restart/rescan preserves ignored candidates and never enrolls or provisions a service.
- [ ] One repository/file failure preserves successful candidates and exposes scoped errors.
- [ ] Candidate identity survives repository rename and remains distinct for each root filename.

## Verification

Test repeated/concurrent scans, restart, ignore persistence, repository renames, partial results, and zero provisioning effects. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

