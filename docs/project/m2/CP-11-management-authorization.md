# CP-11 — Enforce management authorization and mutation protection

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Authorize every management operation independently of browser routing.

## Dependencies

[CP-10](../m2/CP-10-github-login-sessions.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [frontend](../../frontend.md)

## Scope

- Add deny-by-default administrator middleware/handler policy and shared authorized identity context.
- Apply the CP-07 CSRF/origin policy to mutations and recheck current username policy on protected requests.
- Return stable secret-safe API errors under /api without SPA fallback.

## Acceptance criteria

- [ ] Application-only users cannot access administration; administrator-only users do not gain private-application access.
- [ ] Removing a username revokes existing-session access; case/rename handling follows the agreed identity policy.
- [ ] Unauthenticated, forged-origin, and unauthorized mutations fail before any effect.

## Verification

Test access matrices, direct API calls, revocation, spoofed identity, mutation protection, and API/static routing boundaries. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
