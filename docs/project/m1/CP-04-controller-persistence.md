# CP-04 — Implement controller persistence

Milestone: [M1](../_milestones.md) · Status: Complete · PR: — (local commit workflow)

Implement the approved atomic YAML metadata snapshot at `_platform/state/controller.yaml` and lifetime OS lock on `_platform/state/controller.lock`.

## Dependencies

[CP-01](../m1/CP-01-persistence-and-ownership-adr.md), [CP-02](../m1/CP-02-shared-contracts.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)
- [gitops](../../gitops.md)

## Scope

- Implement one typed versioned YAML snapshot with schema/commit/record generations, stable identities, invariant validation, bounded capacity, and stale-generation checks. Keep canonical host configuration and secret values separate; no SQLite or database server.
- Serialize bounded writes in a dedicated worker, outside the request event loop: exclusive same-directory temporary file, write/flush/file sync, atomic replacement, directory sync, then publish/acknowledge. Follow the configuration/storage guide's indeterminate-commit and recovery rules; never promote temporary files or regenerate missing existing identities.
- Hold the stable lock inode for process lifetime before recovery/migration/effects; contenders fail startup. Back up and sync committed state before ordered whole-snapshot migrations; reject unsupported versions and preserve identities.
- Expose durable commit operations for desired state, approvals, inventory, revision transitions, and operations without speculative domain workflows.
- Handle permissions, corruption, full/unwritable storage, unsupported versions, installation/cluster mismatch, and bounded blocking work. Stop further writes/effects on uncertain durability; resolve retries by durable operation identity.

## Acceptance criteria

- [x] Interrupted writes recover a complete committed state without lost identities or fabricated successful operations.
- [x] Migration failure, full disk, unwritable paths, and competing writers produce typed actionable errors.
- [x] Store operations preserve secret separation and can support restart-safe enrollment and reconciliation.

## Verification

Run persistence fault-injection and restart tests, migration fixtures, and concurrent-writer tests. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [x] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

Evidence (2026-10-18): strict red/green tests cover atomic commit/restart, partial writes and injected full-disk/file-sync/rename/directory-sync failures, lost responses, halted effect admission, shutdown draining, immutable identities and operation intents, stale commit/record generations, bounded capacity, malformed/duplicate/unknown YAML, migration backups/failure, wrong bindings, missing existing state, and unsafe/unwritable entries. A real child process verifies lock contention and crash release. Desired descriptor content uses a validated typed extension point inside the sole YAML snapshot; CP-05 supplies its canonical schema, and CP-06 wires startup/effect dispatch. No domain workflows or external effects were added.

Validation: Current verification commands are `pnpm check`, `pnpm test`, and `pnpm build`; rerun them for the migrated implementation. Fault injection establishes the commit/recovery protocol; privileged appliance/power-loss acceptance remains separate. No PR was created, per the requested local-only workflow.
