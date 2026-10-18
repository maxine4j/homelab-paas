# CP-04 — Implement controller persistence

Milestone: [M1](../_milestones.md) · Status: Not started · PR: —

Implement the approved atomic YAML metadata snapshot at `_platform/state/controller.yaml` and lifetime OS lock on `_platform/state/controller.lock`.

## Dependencies

[CP-01](../m1/CP-01-persistence-and-ownership-adr.md), [CP-02](../m1/CP-02-shared-contracts.md).

## Read first

- [configuration and storage](../../configuration-and-storage.md)
- [reconciliation](../../reconciliation.md)
- [gitops](../../gitops.md)

## Scope

- Implement one typed versioned YAML snapshot with schema/commit/record generations, stable identities, invariant validation, bounded capacity, and stale-generation checks. Keep canonical host configuration and secret values separate; no SQLite or database server.
- Serialize bounded writes outside Tokio executor threads: exclusive same-directory temporary file, write/flush/file sync, atomic replacement, directory sync, then publish/acknowledge. Follow the configuration/storage guide's indeterminate-commit and recovery rules; never promote temporary files or regenerate missing existing identities.
- Hold the stable lock inode for process lifetime before recovery/migration/effects; contenders fail startup. Back up and sync committed state before ordered whole-snapshot migrations; reject unsupported versions and preserve identities.
- Expose durable commit operations for desired state, approvals, inventory, revision transitions, and operations without speculative domain workflows.
- Handle permissions, corruption, full/unwritable storage, unsupported versions, installation/cluster mismatch, and bounded blocking work. Stop further writes/effects on uncertain durability; resolve retries by durable operation identity.

## Acceptance criteria

- [ ] Interrupted writes recover a complete committed state without lost identities or fabricated successful operations.
- [ ] Migration failure, full disk, unwritable paths, and competing writers produce typed actionable errors.
- [ ] Store operations preserve secret separation and can support restart-safe enrollment and reconciliation.

## Verification

Run persistence fault-injection and restart tests, migration fixtures, and concurrent-writer tests. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
