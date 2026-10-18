# CP-23 — Implement web/worker lifecycle

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Run supported applications with explicit routing, health, and rollout guarantees.

## Dependencies

[CP-12](../m2/CP-12-route-forward-auth.md), [CP-20](../m4/CP-20-storage-and-secrets.md), [CP-21](../m4/CP-21-network-policy.md), [CP-22](../m4/CP-22-reconciliation-engine.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [descriptors](../../descriptors.md)
- [access and ingress](../../access-and-ingress.md)

## Scope

- Implement workload/Service/route operations with environment/files, resources, probes, replicas, shutdown, HTTP/streaming settings, and digest recording.
- Implement rolling/recreate selection, progress deadlines, spare-capacity requirements, traffic draining, and worker overlap/shutdown semantics.
- Integrate route registry and public/private middleware intent only after policy/storage/secrets prerequisites.

## Decisions to resolve

Agree rollout failure/rollback policy and tag resolution behavior; never assume Kubernetes automatically rolls back or reverses database migrations. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Compatible rolling updates keep old healthy capacity when the new image fails; recreate interruption is explicit.
- [ ] Workers receive no public ingress and running status is not represented as proof of job completion.
- [ ] Deployed digests, rollout conditions, route auth, graceful termination, and failure diagnostics are observable.

## Verification

Continuously issue HTTP requests through successful/failed rolling rollouts; test recreate, worker shutdown, public/private routing, and image resolution failures. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
