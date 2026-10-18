# CP-17 — Expose discovery and review APIs

Milestone: [M3](../_milestones.md) · Status: Not started · PR: —

Give administrators exact-revision discovery previews before any deployment authorization.

## Dependencies

[CP-11](../m2/CP-11-management-authorization.md), [CP-16](../m3/CP-16-candidate-state.md).

## Read first

- [frontend](../../frontend.md)
- [gitops](../../gitops.md)
- [descriptors](../../descriptors.md)

## Scope

- Add paginated candidate/scan reads, authenticated rescan, ignore operations, and stable diagnostic contracts.
- Expose immutable reviewed revision, metadata, validation, resources, routes, storage, and requested permissions.
- Keep discovery failures distinct from application health; present unsupported variants as invalid rather than deployable.

## Acceptance criteria

- [ ] Every read/mutation enforces administration, and mutations use the established CSRF/origin policy.
- [ ] Invalid files remain inspectable with diagnostics; previews are secret-redacted and cause no resource allocation.
- [ ] No acceptance/deployment endpoint is enabled by this ticket; CP-24 adds acceptance with a working actuator.

## Verification

Test pagination, exact-revision preview, invalid candidates, scan errors, authorization, redaction, and absence of provisioning. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

