# CP-12 — Implement route authorization and ingress integration

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Authorize private routes using trusted ingress and a platform-owned route registry.

## Dependencies

[CP-07](../m2/CP-07-session-trust-adr.md), [CP-09](../m2/CP-09-certificate-renewal.md), [CP-10](../m2/CP-10-github-login-sessions.md), [CP-11](../m2/CP-11-management-authorization.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [descriptors](../../descriptors.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement private /api forward-auth and route registration interfaces for management and future resource planners.
- Generate Traefik route/middleware intent with trusted header stripping and only allowlisted returned identity headers.
- Use the minimal ingress publication integration from CP-09; application route provisioning is completed by CP-23.

## Acceptance criteria

- [ ] Unknown routes, forged hosts/identities, and untrusted direct forward-auth callers cannot obtain access.
- [ ] Private routes enforce their applicable independent allowlist and fail closed during auth unavailability.
- [ ] Explicit public routes bypass forward-auth entirely while still stripping spoofed identity headers; management always stays private.

## Verification

Exercise trusted/untrusted ingress requests, independent allowlists, public-route zero-auth-call behavior, streaming path separation, and outages. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

