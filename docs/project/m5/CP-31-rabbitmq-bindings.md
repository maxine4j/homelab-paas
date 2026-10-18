# CP-31 — Implement RabbitMQ consumer bindings

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Provision scoped broker access for declared consumers without exposing administrative credentials.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-30](../m5/CP-30-rabbitmq-lifecycle.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement stable users/vhosts/permissions from typed binding intent using maintained broker interfaces.
- Publish explicit connection mappings and entitled secrets only after scoped provisioning; add precise network grants.
- Handle retries and binding retirement with durable identity and retained-state policy.

## Acceptance criteria

- [ ] Consumers can access permitted vhosts/operations and are denied unrelated broker scope.
- [ ] Restart/reconcile preserves passwords and vhost/user identity without duplicate provisioning.
- [ ] Failed permission/credential publication is recoverable and reported without leaking secrets.

## Verification

Test positive/negative vhost permissions, repeated provisioning, credential stability, interrupted publication, and network isolation. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
