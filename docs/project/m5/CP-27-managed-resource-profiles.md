# CP-27 — Define managed-resource profiles and contracts

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Specify supported managed-resource behavior before enabling stateful descriptor variants.

## Dependencies

[CP-05](../m1/CP-05-web-worker-descriptors.md), [CP-23](../m4/CP-23-web-worker-lifecycle.md).

## Read first

- [descriptors](../../descriptors.md)
- [reconciliation](../../reconciliation.md)
- [configuration and storage](../../configuration-and-storage.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Record owner-approved PostgreSQL/RabbitMQ versions and the exact FerretDB/backend combination with pinned component images.
- Extend canonical schemas for managed variants, defaults, typed binding permissions/credential scopes/mappings, health, retention, and upgrade constraints.
- Define lifecycle/binding adapter contracts and plan semantics without prematurely enabling deployment for unimplemented variants.

## Decisions to resolve

Agree supported versions/backend, credential and permission profiles, defaults, and upgrade boundaries. Do not infer availability guarantees or automatic major upgrades. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Supported versions/configurations and incompatible transitions are explicit and validated before mutation.
- [ ] Binding intent scopes credentials and network reachability; arbitrary images are not assumed to consume DATABASE_URL.
- [ ] Unsupported resource profiles remain non-enrollable until their lifecycle implementation is available.

## Verification

Validate representative managed descriptors and invalid version/permission/reference combinations through shared schemas and TypeScript validation. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
