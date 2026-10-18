# CP-09 — Implement certificate publication and renewal

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Keep a valid active certificate available while issuance and renewal run independently.

## Dependencies

[CP-08](../m2/CP-08-acme-dns-issuance.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement scheduled renewal, expiry conditions, certificate/key validation, and atomic TLS Secret publication.
- Add the minimal owned Kubernetes client/RBAC/mount/bootstrap integration needed for certificate publication; CP-18 later reuses and extends it.
- Ensure one certificate owner, disable competing Traefik ACME, and gate management login until valid HTTPS is active.

## Acceptance criteria

- [ ] Failed renewal or publication preserves the currently valid key/chain pair.
- [ ] Restart recovers active/renewing state without issuance on every startup.
- [ ] Invalid bootstrap configuration or unavailable initial trusted HTTPS cannot enable login/onboarding.

## Verification

Test validation/replacement, retry/publication failure, restart, expiry status, and login gating; use an explicit ingress integration test. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
