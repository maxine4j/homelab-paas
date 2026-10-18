# CP-01 — Record persistence and ownership decisions

Milestone: [M1](../_milestones.md) · Status: Complete · PR: —

Define how one controller durably owns state and Kubernetes resources before persistence is implemented.

## Dependencies

None; follow the repository instructions and binding specifications.

## Read first

- [platform spec](../../platform-spec.md)
- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)

## Scope

- Write an ADR comparing local controller-store options without adding a database server.
- Specify record versioning/migrations, durable commit boundaries, interrupted-write recovery, and prevention of concurrent controller writers.
- Specify namespace/label/field ownership, inventory identity, conflict handling, and whether CRDs are necessary.

## Decisions to resolve

Resolved by owner on 2026-10-18: file-based storage with one atomic YAML metadata snapshot, a lifetime OS file lock, one namespace per service, and no CRDs. Commit/recovery/migration and ownership rules are incorporated directly into the binding guides and affected implementation tickets. Concrete limits/library choices and explicitly separate product policies remain unresolved in their respective tickets.

## Acceptance criteria

- [x] Owner decisions are recorded with alternatives and consequences; recommendations are distinguished from settled requirements.
- [x] The design covers persisting identity before external mutation, restart recovery, and cleanup that cannot delete retained data.
- [x] The ADR maps host configuration, Git desired state, enrollment, and observed state to their authoritative owners.

## Verification

Review crash, duplicate-controller, migration, and ownership-conflict scenarios against the ADR. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

Accepted: [ADR 0001 — Controller persistence and Kubernetes ownership](../../adr/0001-controller-persistence-and-ownership.md).

Owner approval recorded on 2026-10-18. Operative requirements are in the platform, configuration/storage, GitOps, descriptor, and reconciliation guides; the ADR preserves alternatives and rationale. CP-04's architecture prerequisite is satisfied.

Verification evidence: design review covers interrupted commits, duplicate controllers, migration failures, ownership conflicts, and retained cleanup. Documentation relative links, whitespace, and decision-status consistency checked. This is documentation review only; implementation fault-injection and Kubernetes tests remain with the dependent tickets. No runtime/build changes in CP-01. No PR created in this task.

- [x] Scope, acceptance criteria, and verification are complete; evidence recorded above. PR: — (not created).
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
