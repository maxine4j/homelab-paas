# CP-15 — Implement immutable descriptor discovery

Milestone: [M3](../_milestones.md) · Status: Not started · PR: —

Discover candidates from a stable repository snapshot without executing repository content.

## Dependencies

[CP-05](../m1/CP-05-web-worker-descriptors.md), [CP-14](../m3/CP-14-github-repository-enumeration.md).

## Read first

- [gitops](../../gitops.md)
- [descriptors](../../descriptors.md)

## Scope

- Resolve each current default branch to an immutable commit and enumerate its nonrecursive root tree.
- Fetch matching regular root-level .sd.yaml blobs at that exact revision; bound file size and parsing work.
- Use the shared parser and retain repository/branch/path/commit/blob identity, metadata, summaries, and scoped diagnostics.

## Acceptance criteria

- [ ] Nested files, symlinks, submodules, wrong suffixes, and arbitrary includes/scripts are never followed.
- [ ] Branch movement during a scan cannot mix a tree and descriptor from different revisions.
- [ ] Empty/missing branches, invalid descriptors, and unreadable blobs appear individually without hiding other candidates.

## Verification

Test immutable-snapshot races, exact suffix/type filtering, malformed/oversized files, empty repositories, and no repository execution. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
