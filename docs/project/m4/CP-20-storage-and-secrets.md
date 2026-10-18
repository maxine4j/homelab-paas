# CP-20 — Implement safe storage and secret materialization

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Materialize only a resource's permitted storage and secrets with stable identity across retries.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-04](../m1/CP-04-controller-persistence.md), [CP-18](../m4/CP-18-kubernetes-adapter.md), [CP-19](../m4/CP-19-kubernetes-planning.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [descriptors](../../descriptors.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Allocate resource data/volume/credential paths below the configured host root with containment and symlink-escape protection.
- Implement configured directory aliases/modes, ephemeral directories, ConfigMap/secret-backed files, and entitled secret injection.
- Persist generated credentials before publication and reconcile retained storage without destructive owner-reference cascades.
- Commit path/credential identity and pending intent before materialization; atomically create without overwriting existing credentials, sync file/directory before external use, and validate/reuse on restart. Missing/corrupt credentials for provisioned resources block recovery instead of regenerating passwords. Retain PVs/PVCs and identity/path reservations; use explicit `Retain` PV reclaim policy.

## Acceptance criteria

- [ ] Traversal, reserved IDs, symlink escapes, arbitrary host paths, and platform-secret consumption are rejected.
- [ ] Crash/retry/redeploy reuses stable generated credentials and existing retained paths.
- [ ] Only entitled namespaces/resources receive secrets; file permissions and read-only alias modes are enforced.

## Verification

Exercise path attacks, concurrent allocation, interrupted generation/publication, full/unwritable storage, and credential stability. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
