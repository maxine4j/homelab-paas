# CP-07 — Record session and trust-boundary design

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Specify browser sessions and trusted ingress behavior before implementing authentication.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-04](../m1/CP-04-controller-persistence.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)
- [frontend](../../frontend.md)

## Scope

- Write an ADR for isolated auth/management origin, application session exchange, logout, expiry, and signing/session storage.
- Define trusted proxy provenance, forwarded-host handling, route lookup, identity-header stripping, safe return URLs, and mutation protection.
- Define configuration reload, allowlist revocation, provider identity revalidation, and secret-rotation behavior.

## Decisions to resolve

Owner agreement is required for session exchange, lifetimes, trusted proxy boundary, reload, and rotation policy. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Flows cover administrator-only, application-only, both-list, revoked, and renamed users without implicit privilege inheritance.
- [ ] Application origins cannot acquire a broad parent-domain credential or forge management/forward-auth identity.
- [ ] Failure behavior and bootstrap HTTPS gating are explicit; API and SPA trust boundaries are documented.

## Verification

Review login/callback/application exchange sequences and spoofing, CSRF, replay, revocation, and outage scenarios. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
