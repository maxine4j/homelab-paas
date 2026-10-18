# CP-02 — Introduce shared contracts and generation

Milestone: [M1](../_milestones.md) · Status: Complete · PR: — (local dev-local workflow)

Create one authoritative Rust model boundary and reproducible browser-contract generation.

## Dependencies

None; follow the repository instructions and binding specifications.

## Read first

- [platform spec](../../platform-spec.md)
- [descriptors](../../descriptors.md)
- [frontend](../../frontend.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Add packages/shared-contracts with initial configuration/API/error primitives and explicit validation boundaries.
- Export JSON Schema from Rust and derive TypeScript with tooling owned by services/paas-ui/tools/contracts.
- Wire generation and example validation into Bazel; keep outputs out of the source tree and backend builds independent of frontend tooling.

## Acceptance criteria

- [x] Backend and generated browser contracts agree on representative valid and invalid payloads.
- [x] Clean Bazel builds generate contracts without prepared node_modules or source-tree writes.
- [x] Cargo and Bazel use compatible features/dependencies; generated contracts contain no secret values or backend adapters.

## Verification

Run contract/export fixtures, Bazel generation and check targets, and a backend-only build. For implementation changes, run applicable Bazel checks and tests; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [x] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

Implemented the shared Rust crate with validated credential-name references, closed public error codes, field diagnostics, and strict API errors. Unknown API routes now use the shared JSON error contract. Full bootstrap configuration remains CP-03; descriptor models remain CP-05.

Verification (2026-10-18):

- Observed failing Rust fixtures for empty references and unknown fields, then passing fixtures after validation; observed a failing API error response test, then passing after integration.
- Observed browser compiler fixtures failing against the empty generator, then passing against Rust-derived declarations. Rust and Ajv validate the same 11 valid/invalid examples; generation reproducibility is checked.
- `bazel test //...`: all seven test targets passed.
- After `bazel clean`, `bazel build --sandbox_block_path=/Users/mings/repo/homelab-paas/services/paas-ui/node_modules //:check //services/paas-ui:bundle //services/control-plane:control-plane` passed. Generated schema/declarations remain under Bazel outputs.
- `bazel build --config=linux-arm64 //services/control-plane:control-plane` passed, without frontend generation.
- `cargo build -p control-plane --locked` and `cargo test -p shared-contracts -p control-plane --locked` passed. Buildifier and diff whitespace checks passed.

No PR or publication: the requested workflow creates one local commit.
