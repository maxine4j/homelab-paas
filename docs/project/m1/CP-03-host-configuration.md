# CP-03 — Implement host configuration and secret references

Milestone: [M1](../_milestones.md) · Status: Complete · PR: — (local dev-local commit)

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

## Recorded decision

Owner decision, 2026-10-18: use `org` everywhere in the configuration discriminator. The guide and typed schema now agree; `organization` is rejected.

## Acceptance criteria

- [x] Missing or invalid bootstrap settings leave management unavailable with actionable local diagnostics.
- [x] Case-insensitive username/owner handling preserves separation of application access, administration, and discovery.
- [x] Secrets never appear in serializable configuration or debug/error output; file permissions and missing references are validated.

## Verification

Use valid/invalid file fixtures, case normalization, malformed names, missing secrets, permission failures, and redaction checks. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [x] Scope, acceptance criteria, and verification are complete. No PR: local workflow.
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

Implemented `services/control-plane/src/config.ts`: strict typed YAML, reusable parse/validate path, normalized independent scopes, domain/HTTPS callback/ACME checks, named secret resolution, and redacted diagnostics. Host loading uses directory-relative non-symlink opens, regular-file checks, a 1 MiB file limit, and owner-only secret file modes. Secret values are private and redact JSON serialization and debug inspection.

Invalid settings return an error without a usable bootstrap context. Runtime startup integration is CP-06, including local host-file mounts; the existing health/hello-world MVP has no management login or management operations and keeps its current development lifecycle.

Verification: focused tests cover valid/invalid disk inputs, malformed names, empty/duplicate scopes, missing references with field diagnostics, unsafe permissions, symlink escapes, nonregular/oversized files, and serialization/debug/error redaction. Current verification commands are `pnpm check`, `pnpm test`, and `pnpm build`; rerun them for the migrated implementation. No Docker/K3s or external-service execution.
