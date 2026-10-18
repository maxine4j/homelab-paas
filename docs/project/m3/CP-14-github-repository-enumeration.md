# CP-14 — Implement GitHub repository enumeration

Milestone: [M3](../_milestones.md) · Status: Not started · PR: —

Enumerate exactly the configured owners' readable repositories with honest completeness reporting.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-06](../m1/CP-06-application-runtime.md).

## Read first

- [gitops](../../gitops.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Implement authenticated user/organization enumeration with full pagination and immutable repository IDs.
- Cover private personal repositories through suitable authenticated APIs and filter all results by configured owner.
- Bound concurrency; handle conditional requests/caching, rate limits, cancellation, backoff, and per-owner authorization diagnostics.

## Acceptance criteria

- [ ] Token access never expands discovery to collaborators or unrelated owners.
- [ ] Partial/truncated/failed enumeration is reported as incomplete and cannot imply repository or service deletion.
- [ ] Fork/archive metadata and repository rename metadata are retained rather than silently filtered.

## Verification

Use GitHub API fixtures for multiple pages, private visibility, overlapping owners, rate limits, partial failure, and cancellation. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
