# CP-02 — Introduce shared contracts and generation

Milestone: [M1](../_milestones.md) · Status: Complete · PR: — (local dev-local workflow)

Create one authoritative shared schema boundary and reproducible browser-contract generation.

## Dependencies

None; follow the repository instructions and binding specifications.

## Read first

- [platform spec](../../platform-spec.md)
- [descriptors](../../descriptors.md)
- [frontend](../../frontend.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Add packages/shared-contracts with initial configuration/API/error primitives and explicit validation boundaries.
- Keep canonical JSON Schemas and TypeScript generation in packages/shared-contracts; both services import the workspace package.
- Wire generation and example validation into pnpm; keep generated outputs ignored and backend builds independent of frontend tooling.

## Acceptance criteria

- [x] Backend and generated browser contracts agree on representative valid and invalid payloads.
- [x] Clean pnpm builds generate contracts after a locked dependency install.
- [x] Both services consume one shared workspace package; generated contracts contain no secret values or backend adapters.

## Verification

Run contract fixtures, pnpm generation and checks, and a backend-only build. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [x] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

Implemented the shared TypeScript package with validated credential-name references, closed public error codes, field diagnostics, and strict API errors. Unknown API routes now use the shared JSON error contract. Full bootstrap configuration remains CP-03; descriptor models remain CP-05.

Migration verification uses `pnpm check`, `pnpm test`, and `pnpm build`. Shared runtime fixtures and compiler fixtures cover empty references, closed error codes, unknown fields, and the absence of resolved secrets. Both services consume the generated declarations. Previous build-system command transcripts were superseded by the workspace migration.
