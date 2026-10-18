# CP-18 — Implement the Kubernetes adapter and development prerequisites

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Extend the early certificate integration into the shared Kubernetes runtime used by reconciliation.

## Dependencies

[CP-06](../m1/CP-06-application-runtime.md), [CP-09](../m2/CP-09-certificate-renewal.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [configuration and storage](../../configuration-and-storage.md)
- [platform spec](../../platform-spec.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Reuse and extend the CP-09 Tokio-compatible kube client with watches, timeouts, cancellation, owned apply/delete, and typed errors.
- Create absent objects with persisted ownership tokens; bind interrupted creates only from matching durable intent/token. Verify inventory UID/ownership before server-side apply with a stable manager and `force: false`; delete exact runtime targets with UID/resource-version preconditions. Report conflicts rather than adopting, overwriting, or broadly deleting.
- Provide explicit service-account/RBAC and config/state/storage mounts for local integration without mounting a Docker socket.
- Use one namespace per service plus reserved platform/observability namespaces, no CRDs, and the shared canonical state mount/installation binding. Require explicit bootstrap ownership handoff; retain namespaces and data/credential objects during ordinary cleanup.
- Add explicit reusable k3d integration targets/fixtures; document separate production bootstrap obligations, including Kubernetes secret encryption at rest.

## Acceptance criteria

- [ ] Unrelated objects/fields cannot be silently adopted or overwritten; ownership conflicts are actionable.
- [ ] Expired watches, API timeouts, and permission failures recover or report bounded failures.
- [ ] Ordinary Bazel tests do not start Docker; local deployment retains loopback/private management boundaries.

## Verification

Test adapter behavior against API doubles and run explicit K3s ownership/RBAC/watch integration; do not claim production nested-runtime acceptance. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
