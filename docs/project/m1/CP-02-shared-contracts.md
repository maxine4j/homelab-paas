# CP-02 — Introduce shared TypeScript contracts

Milestone: [M1](../_milestones.md) · Status: Complete · PR: — (local dev-local workflow)

Define shared TypeScript contracts consumed directly by both services, without code generation.

## Dependencies

None; follow the repository instructions and binding specifications.

## Read first

- [platform spec](../../platform-spec.md)
- [descriptors](../../descriptors.md)
- [frontend](../../frontend.md)
- [build and ci](../../build-and-ci.md)

## Scope

- Add packages/shared-contracts with initial configuration/API/error primitives and explicit validation boundaries.
- Define canonical TypeScript contracts in packages/shared-contracts; both services import the workspace package.
- Compile contracts with TypeScript through pnpm; keep backend builds independent of frontend tooling.

## Acceptance criteria

- [x] Backend and browser consume the same types, with compiler fixtures for valid and invalid values.
- [x] Clean pnpm builds compile shared contracts after a locked dependency install.
- [x] Both services consume one shared workspace package; shared contracts contain no secret values or backend adapters.

## Verification

Run compiler fixtures, pnpm checks, and a backend-only build. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [x] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [x] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).

The current package exports the shared `ApiError` and `CredentialReference` types directly. The previous generator and runtime schema implementation were removed; validate untrusted values with Zod at adapter boundaries. Type-only contracts are verified by the compiler, including the SPA compiler fixtures. Verification uses `pnpm check`, `pnpm test`, and `pnpm build`.
