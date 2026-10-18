# Frontend instructions

Read [the frontend and management API guide](../../docs/frontend.md) before changing files here. It contains UI requirements, TypeScript conventions, generated-contract rules, and frontend verification requirements.

Use the root pnpm workspace on Node 24, Vitest for tests, and Oxc's oxlint/oxfmt for linting/formatting. Import public contracts from `@homelab-paas/shared-contracts`; do not copy schemas or backend implementation into the SPA. Ask the owner before adding a new third-party dependency.

Read [build and CI](../../docs/build-and-ci.md) only when changing workspace scripts, dependency integration, tooling, contract generation, image packaging, or workflows. Running existing commands to verify a UI change does not require it.
