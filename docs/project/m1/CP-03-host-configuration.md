# CP-03 — Implement host configuration and secret references

Milestone: [M1](../_milestones.md) · Status: Not started · PR: —

Load the canonical host configuration and reject unsafe or incomplete bootstrap settings.

## Dependencies

[CP-02](../m1/CP-02-shared-contracts.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [access and ingress](../../access-and-ingress.md)
- [gitops](../../gitops.md)

## Scope

- Implement typed disk configuration and named references into the restrictive host secret file.
- Validate domain/callback/TLS settings, explicit non-empty independent username lists, discovery owners, names, and credential references.
- Provide redacted diagnostics and reusable validation for future configuration APIs; do not introduce a second configuration store.

## Decisions to resolve

Resolve `organization` versus `org` in the configuration guide and update the example consistently. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Missing or invalid bootstrap settings leave management unavailable with actionable local diagnostics.
- [ ] Case-insensitive username/owner handling preserves separation of application access, administration, and discovery.
- [ ] Secrets never appear in API representations, errors, or logs; file permissions and missing references are validated.

## Verification

Use valid/invalid file fixtures, case normalization, malformed names, missing secrets, permission failures, and redaction checks. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

