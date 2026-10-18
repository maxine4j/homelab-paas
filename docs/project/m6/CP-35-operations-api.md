# CP-35 — Expose operational management APIs

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Expose actionable controller and resource state without giving administrators raw Kubernetes editing flows.

## Dependencies

[CP-13](../m2/CP-13-configuration-api.md), [CP-26](../m4/CP-26-source-lifecycle.md), [CP-29](../m5/CP-29-postgres-bindings.md), [CP-31](../m5/CP-31-rabbitmq-bindings.md), [CP-33](../m5/CP-33-ferretdb-bindings.md).

## Read first

- [frontend](../../frontend.md)
- [reconciliation](../../reconciliation.md)
- [gitops](../../gitops.md)
- [access and ingress](../../access-and-ingress.md)

## Scope

- Add paginated redacted reads for topology/dependencies, health/conditions, revision/operation history, digests, storage/retention, and certificate status.
- Expose authenticated sync and supported restart actions with durable operation identity and progress.
- Distinguish declared topology from runtime observations and scan/tracking failures from application health; preserve Git ownership.

## Acceptance criteria

- [ ] Direct API access enforces administration/CSRF and stable errors; unsupported actions are rejected.
- [ ] Restart/sync cannot create persistent descriptor overrides or reveal secret values.
- [ ] Partial failures and stale observations remain visible; no unmeasured runtime traffic map is claimed.

## Verification

Test contract pagination, authorization, operation retries, stale/partial state, redaction, and no Git-owned configuration overrides. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

