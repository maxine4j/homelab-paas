# Development

## Toolchain

Use the existing pnpm workspace and Node.js 24. The exact pnpm version is pinned by `packageManager` in the root `package.json`; `.nvmrc` supplies the local Node version.

The existing tooling is part of the stack:

- TypeScript with ES modules.
- Oxc's `oxlint` and `oxfmt`, using the checked-in configuration and lint rules.
- Vitest for tests.
- React and Vite for the management UI stub.
- Python for the existing development and image scripts.

Keep versions and commands in their existing manifests and configuration files. Do not introduce a competing package manager, formatter, linter, or test runner.

## Workspace

| Path                         | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `services/paas/`             | TypeScript/Node.js control plane                                         |
| `services/paas-ui/`          | Management UI stub; product and management API requirements are deferred |
| `packages/shared-contracts/` | Public contracts shared by the control plane and UI                      |
| `scripts/`                   | Repository tooling and development scripts                               |

The [architecture](architecture.md) and linked requirements describe the intended platform. Existing implementation, packaging, and deployment scripts may need later changes to match it; their presence does not establish additional product requirements.

Import shared public contracts from `@homelab-paas/shared-contracts`. Do not duplicate schemas or import backend implementation into the UI. No contract-generation workflow is prescribed here.

## Commands

Run from the repository root:

| Command                          | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install pinned dependencies                                                     |
| `pnpm dev`                       | Build shared contracts and start the control plane and UI development processes |
| `pnpm format:check`              | Check formatting                                                                |
| `pnpm format`                    | Apply formatting                                                                |
| `pnpm lint`                      | Run Oxc lint checks with warnings treated as errors                             |
| `pnpm typecheck`                 | Build shared contracts and typecheck workspace packages                         |
| `pnpm check`                     | Run formatting, lint, and type checks                                           |
| `pnpm test`                      | Run tooling tests, build shared contracts, and run workspace tests              |
| `pnpm build`                     | Build workspace packages                                                        |

Run checks appropriate to the change. For code changes, use `pnpm check`, relevant tests, and `pnpm build` when build output or packaging is affected. For documentation-only changes, check formatting and relative links; application tests are unnecessary.

Consult the scripts before invoking `pnpm image` or `pnpm dev:deploy`: these are existing packaging and deployment entry points, and may still require alignment with the intended architecture.
