# CP-08 — Implement ACME issuance and DigitalOcean DNS-01

Milestone: [M2](../_milestones.md) · Status: Not started · PR: —

Acquire certificates with maintained asynchronous protocol clients and recoverable DNS challenges.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-04](../m1/CP-04-controller-persistence.md), [CP-06](../m1/CP-06-application-runtime.md).

## Read first

- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Pin compatible ACME/DigitalOcean integration dependencies; implement wildcard issuance and apex coverage only when used.
- Persist account keys, orders, challenge metadata, and certificate material under restrictive platform paths.
- Implement propagation checks, bounded retries/backoff, concurrent TXT challenge handling, cleanup, and resumed orders.

## Acceptance criteria

- [ ] Interrupted issuance resumes without unnecessarily creating accounts/orders or deleting another active challenge.
- [ ] Configuration/credential/provider failures are actionable and secret-redacted.
- [ ] Development and automated integration use staging or protocol test doubles, never implicit production issuance.

## Verification

Exercise order/challenge success, propagation timeout, rate limits, concurrent TXT records, cleanup failure, and restart recovery. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
