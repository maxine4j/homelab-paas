# Management UI

The management UI and its API contract are defined in [management UI](../../docs/management-ui.md). Keep behaviour within that scope unless explicitly requested.

Follow the root [agent instructions](../../AGENTS.md). Read [development](../../docs/development.md) when changing tooling, dependencies, shared contracts, or verification.

Use the existing React/Vite setup with Node.js 24, pnpm, TypeScript, Vitest, and Oxc. Import public contracts from `@homelab-paas/shared-contracts`; do not duplicate schemas or import backend implementation into the UI.

Ask the owner before adding a third-party dependency.
