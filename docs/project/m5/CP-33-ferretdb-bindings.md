# CP-33 — Implement FerretDB consumer bindings

Milestone: [M5](../_milestones.md) · Status: Not started · PR: —

Provide the supported scoped FerretDB access model through explicit consumer bindings.

## Dependencies

[CP-21](../m4/CP-21-network-policy.md), [CP-32](../m5/CP-32-ferretdb-lifecycle.md).

## Read first

- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Implement CP-27-approved authentication/permission profiles using supported FerretDB/backend capabilities.
- Persist consumer credentials, publish explicit connection mappings to entitled workloads, and generate precise network grants.
- Make provisioning/retry and binding retirement honor resource identity and retained-state policy.

## Acceptance criteria

- [ ] Supported scopes are enforced in actual database operations; unsupported isolation claims are rejected.
- [ ] Consumers cannot obtain platform/backend administrative credentials or unrelated resource secrets.
- [ ] Restart/partial publication preserves existing credentials and converges without duplicate identities.

## Verification

Verify actual supported authentication/authorization behavior, denied unrelated access, network isolation, stable credentials, and provisioning recovery. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

