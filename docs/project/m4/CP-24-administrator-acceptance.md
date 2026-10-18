# CP-24 — Implement durable administrator acceptance

Milestone: [M4](../_milestones.md) · Status: Not started · PR: —

Turn one explicitly reviewed descriptor into durable deployment authorization.

## Dependencies

[CP-11](../m2/CP-11-management-authorization.md), [CP-17](../m3/CP-17-discovery-review-api.md), [CP-23](../m4/CP-23-web-worker-lifecycle.md).

## Read first

- [gitops](../../gitops.md)
- [descriptors](../../descriptors.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Add administrator-only acceptance with exact reviewed repository ID, branch/path, commit, and descriptor digest.
- Revalidate freshness, supported full desired state, plan, and cross-source ownership/route conflicts.
- Atomically persist approval identity/time and initial immutable desired revision before enqueueing; recover enqueueing after restart.
- In one YAML snapshot commit, persist enrollment, reviewed commit/digest and normalized snapshot, stable service/resource identities, service/route reservations, and initial pending operation. Enforce repository-ID/pinned-branch/root-path uniqueness and resolve repeated/concurrent requests or lost responses to the existing decision.

## Acceptance criteria

- [ ] Stale reviews are rejected with refreshable diagnostics instead of accepting unseen content.
- [ ] Duplicate/concurrent/retried requests are idempotent and cannot create conflicting service enrollments.
- [ ] The first deployment uses the reviewed revision; other repository descriptors remain unapproved and unprovisioned.

## Verification

Test stale approval races, duplicate/concurrent acceptance, restart between commit/enqueue, service conflicts, auth/CSRF, and exact first deployment. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
