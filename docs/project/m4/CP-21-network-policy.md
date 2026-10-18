# CP-21 — Implement network-policy generation

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Enforce declared connectivity without granting accidental cluster or LAN access.

## Dependencies

[CP-18](../m4/CP-18-kubernetes-adapter.md), [CP-19](../m4/CP-19-kubernetes-planning.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [descriptors](../../descriptors.md)

## Scope

- Generate default-deny ingress/egress and destination/protocol/port-specific grants for DNS, Traefik, monitoring, and declared dependencies.
- Integrate policy application as a mandatory prerequisite to application pods.
- Document and implement agreed external-egress semantics; explicitly gate unsupported egress requests.

## Decisions to resolve

Resolve external internet access per resource/profile and treatment of private cluster/LAN destinations before enabling it. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Undeclared application-to-application and application-to-LAN paths are denied.
- [ ] Declared connections and required infrastructure traffic succeed without broad allow-all exceptions.
- [ ] Public ingress policy does not broaden internal permissions; policy failure prevents application startup.

## Verification

Run actual K3s denied/permitted connection tests, including DNS, ingress, dependency, and external/private-address boundaries. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

