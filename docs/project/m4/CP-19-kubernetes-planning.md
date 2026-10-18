# CP-19 — Implement pure Kubernetes planning

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Translate validated application intent into deterministic reviewable plans without external mutation.

## Dependencies

[CP-01](../m1/CP-01-persistence-and-ownership-adr.md), [CP-05](../m1/CP-05-web-worker-descriptors.md), [CP-12](../m2/CP-12-route-forward-auth.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [descriptors](../../descriptors.md)
- [access and ingress](../../access-and-ingress.md)

## Scope

- Define typed plan operations, dependency ordering, owned object/field identities, and inventory changes.
- Plan namespace/workload/service/route/storage/secret/policy intent from normalized web/worker resources.
- Allocate one namespace per service, reserve `homelab-paas.io/` ownership metadata, and plan explicit runtime/retained inventory with stable target identities/tokens. No CRDs, descriptor-selected namespaces, or disposable ownership cascades into retained resources; PV reclaim policy is `Retain`.
- Detect cross-source service IDs, routes, reserved names, and ownership conflicts; separate preview from secret resolution and execution.

## Acceptance criteria

- [ ] Identical inputs yield equivalent plans independent of source iteration order.
- [ ] Plans establish prerequisites and default deny before launching or exposing workloads.
- [ ] Plan output is secret-redacted and performs no directory creation, credential generation, or Kubernetes writes.

## Verification

Test deterministic ordering, cross-source conflicts, secret redaction, dependency cycles/references, and zero-side-effect planning. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
