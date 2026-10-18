# CP-22 — Implement the reconciliation engine

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Execute durable plans idempotently and resume interrupted work without a new Git commit.

## Dependencies

[CP-04](../m1/CP-04-controller-persistence.md), [CP-18](../m4/CP-18-kubernetes-adapter.md), [CP-19](../m4/CP-19-kubernetes-planning.md), [CP-20](../m4/CP-20-storage-and-secrets.md), [CP-21](../m4/CP-21-network-policy.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [configuration and storage](../../configuration-and-storage.md)
- [gitops](../../gitops.md)

## Scope

- Persist accepted desired state, operation identity, owned inventory, conditions, and partial progress before necessary effects.
- Use the atomic YAML snapshot and lifetime lock: durable target/token/intent → idempotent bounded effect → observed durable result. Recover scheduling from pending operations, inspect uncertain creates/deletes before retries, and pause new effects on failed/indeterminate commits. Use local finalization records, not CRDs/custom-resource finalizers.
- Implement bounded queues, per-service serialization, deadlines, cancellation, backoff, watches, and periodic resync.
- Apply prerequisites in order and expose Accepted/Reconciling/Ready/Degraded/Deleting with actionable reasons; integrate resource operations through explicit adapters.

## Acceptance criteria

- [ ] Restart during provisioning resumes without duplicate resources, lost ownership, or regenerated credentials.
- [ ] Watch/resync repairs drift only within owned fields; unrelated/manual ownership conflicts are reported.
- [ ] Partial Kubernetes application is visible and safely retried; storage/API failures never fabricate Ready.

## Verification

Inject crashes between durable commits and effects, queue saturation, watch loss, API failure, and ownership conflicts. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
