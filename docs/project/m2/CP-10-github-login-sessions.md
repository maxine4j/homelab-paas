# CP-10 — Implement GitHub login and sessions

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Authenticate browsers with GitHub's OAuth2 authorization-code flow and bounded server-owned sessions.

## Dependencies

[CP-07](../m2/CP-07-session-trust-adr.md), [CP-09](../m2/CP-09-certificate-renewal.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [frontend](../../frontend.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Implement /api login/callback/logout endpoints using maintained OAuth2 code flow with state and PKCE.
- Exchange codes server-side, retrieve GitHub user identity, and bind sessions to immutable user ID and verified login.
- Implement the approved cookie/session exchange, signing persistence, expiry, return-URL validation, and logout behavior.

## Acceptance criteria

- [ ] Invalid/replayed state, failed exchanges, unsafe redirects, expired sessions, and provider errors deny authentication.
- [ ] GitHub identity is obtained from its user API; no OIDC discovery or ID-token assumption is introduced.
- [ ] Provider tokens and OAuth secrets remain server-side; browser login does not acquire repository-read scope.

## Verification

Use a controlled GitHub OAuth/user-API double for success, replay, expiry, callback errors, restart, and logout. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
