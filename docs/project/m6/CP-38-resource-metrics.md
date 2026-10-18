# CP-38 — Integrate application and dependency metrics

Milestone: [M6](../_milestones.md) · Status: Not started · PR: —

Scrape declared application endpoints and supported dependency exporters without fabricating coverage.

## Dependencies

[CP-29](../m5/CP-29-postgres-bindings.md), [CP-31](../m5/CP-31-rabbitmq-bindings.md), [CP-33](../m5/CP-33-ferretdb-bindings.md), [CP-36](../m6/CP-36-metrics-infrastructure.md).

## Read first

- [reconciliation](../../reconciliation.md)
- [descriptors](../../descriptors.md)
- [configuration and storage](../../configuration-and-storage.md)

## Scope

- Extend validated metrics intent and central scrape configuration for supported application endpoints.
- Provision pinned supported PostgreSQL/RabbitMQ/FerretDB profile exporters or native metric endpoints with scoped credentials.
- Grant monitoring-only network paths, stable resource identity, and supported/unconfigured/unsupported status.

## Decisions to resolve

Confirm exporter/native endpoint support for each chosen managed version rather than promising unsupported FerretDB/backend metrics. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Application images are not assumed to expose metrics; unsupported/unconfigured coverage is explicit.
- [ ] Exporter credentials are least-scoped, stable, and absent from responses/logs/metric labels.
- [ ] Resource updates and removal update discovery and retire owned exporters safely.

## Verification

Test application opt-in/out, actual managed-resource scrapes, exporter failures, credential scoping, removal, and bounded labels. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
