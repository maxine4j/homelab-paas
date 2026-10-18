# CP-30 — Implement RabbitMQ lifecycle

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Provision a persistent RabbitMQ broker with explicit management exposure.

## Dependencies

[CP-12](../m2/CP-12-route-forward-auth.md), [CP-20](../m4/CP-20-storage-and-secrets.md), [CP-22](../m4/CP-22-reconciliation-engine.md), [CP-27](../m5/CP-27-managed-resource-profiles.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)
- [access and ingress](../../access-and-ingress.md)

## Scope

- Implement the pinned broker workload/service, persistence, stable administrative credentials, probes, and lifecycle conditions.
- Make initialization and interrupted reconciliation safe for existing broker state.
- Provide private opt-in management ingress, baseline backup/restore documentation, and supported-version validation.

## Acceptance criteria

- [ ] Restart/redeploy retains broker data and credentials; normal removal retains persistent state.
- [ ] Management ingress is absent by default and requires the applicable private access policy when enabled.
- [ ] Unsupported upgrades and failed initialization are visible rather than silently rebuilding broker state.

## Verification

Exercise persistent broker restart, interrupted initialization, retained deletion, health failures, and disabled/enabled protected management routing. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
