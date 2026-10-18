# CP-05 — Define and implement web/worker descriptors

Milestone: [M1](../_milestones.md) · Status: Not started · PR: —

Parse and normalize supported application intent once for discovery, previews, and deployment.

## Dependencies

[CP-02](../m1/CP-02-shared-contracts.md), [CP-03](../m1/CP-03-host-configuration.md).

## Read first

- [descriptors](../../descriptors.md)
- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement strict versioned YAML web/worker variants, duplicate-key detection, field diagnostics, and centralized defaults.
- Validate identifiers, references, primary routing, private-by-default exposure, bindings, permissions, storage, probes, resources, and lifecycle settings.
- Produce deterministic redacted resolved previews; reject managed-resource variants until their implementations are supported.

## Decisions to resolve

Agree concrete field shapes, defaults, limits, and compatibility rules for the supported schema; do not expose Kubernetes escape hatches. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Unknown versions/fields, duplicate IDs, invalid public/primary fields, unresolved references, and route/path collisions fail explicitly.
- [ ] Zero/one/multiple-web primary rules and reserved management/platform identities match the specifications.
- [ ] Parsing and previewing cause no provisioning, secret generation, or application-directory allocation.

## Verification

Use positive/negative descriptor fixtures, normalization/hostname/binding cases, and no-side-effect preview tests. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

