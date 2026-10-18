# CP-13 — Add authenticated configuration APIs

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Let administrators inspect and update the canonical host configuration safely.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-07](../m2/CP-07-session-trust-adr.md), [CP-11](../m2/CP-11-management-authorization.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [frontend](../../frontend.md)
- [access and ingress](../../access-and-ingress.md)

## Scope

- Add validated redacted read/update contracts and administrator-only /api handlers.
- Implement atomic canonical host-file writes, concurrent-edit protection, and the approved reload/restart/rotation behavior.
- Preserve secret-reference separation; expose supported settings and local diagnostics without arbitrary host-file browsing.

## Acceptance criteria

- [ ] Disk and API input use the same validation; invalid or stale updates leave the valid file intact.
- [ ] Access/discovery scope changes are explicit and never inferred from the logged-in identity.
- [ ] Secret values are absent from responses/logs; write/reload failure is visible rather than reported as success.

## Verification

Test stale concurrent writes, disk failures, invalid bootstrap updates, reload/revocation effects, authorization, and redaction. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
