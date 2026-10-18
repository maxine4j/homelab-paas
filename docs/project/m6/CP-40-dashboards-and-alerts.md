# CP-40 — Provision dashboards and alerts

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Provide protected monitoring views and honest local/external alert delivery status.

## Dependencies

[CP-12](../m2/CP-12-route-forward-auth.md), [CP-36](../m6/CP-36-metrics-infrastructure.md), [CP-37](../m6/CP-37-centralized-logging.md), [CP-38](../m6/CP-38-resource-metrics.md), [CP-39](../m6/CP-39-pushgateway-integration.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [access and ingress](../../access-and-ingress.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Reconcile pinned Grafana/Alertmanager with budgets, retained configuration/data, sources, dashboards, and administrator-only ingress.
- Generate alerts for polls, stalled rollouts, crash loops, scrape loss, disk, dependency health, and certificate expiry.
- Use explicit host-configured receivers with secret references and validated canonical settings.

## Acceptance criteria

- [ ] Application-only users cannot access monitoring administration; spoofed identity headers do not grant access.
- [ ] No receiver yields visible local alerts without a claim of successful external notification.
- [ ] Dashboards and alert labels identify resources correctly with bounded cardinality and no secret-bearing URLs.

## Verification

Test protected routing, generated dashboards/rules, representative alert firing/resolution, absent receivers, and delivery via test receivers. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
