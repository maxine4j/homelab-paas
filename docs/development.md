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

## Local container environment

From `local/`, run `docker compose up --build -d`. This starts Envoy and the minimal control-plane HTTP server. Control-plane source is bind-mounted and Node watches for changes. Only Envoy publishes a port, on loopback.

`services/paas/Dockerfile` uses Node 24 Alpine with separate build, production dependency installation, and runtime stages. The runtime image contains compiled JavaScript and production dependencies. Compose overrides its command to watch the mounted TypeScript source during local development.

- `etc/` maps to `/etc/homelab-paas` and holds `config.yaml` and static `envoy.yaml`.
- `var/` maps to `/var/homelab-paas` and is ignored by Git. `docker compose down` retains it.
- The Docker socket is mounted for future Engine integration.
- The repository is mounted read-only at `/workspace`; the desired configuration references its `spike-v2` branch and `services/test-service/test-service.sd.yaml`. Commit descriptor edits before future Git reconciliation can see them.

The control plane currently serves only `/health` on port 8080. It does not read platform configuration or deploy descriptors yet. Auth, TLS, reconciliation, and generated Envoy configuration remain unimplemented. `config.yaml` records the local deployment source; auth and TLS settings are intentionally omitted until implemented.

Compose starts only the control plane and Envoy. The PaaS will eventually deploy test-service from its configured descriptor and manage its network and Envoy routes. Check the bootstrap with:

```sh
curl --fail http://localhost:8080/health
```

Envoy uses static HTTP routes for this bootstrap. It has no published admin interface. Future Docker bind mounts created by the control plane must use absolute **host** paths under this checkout’s `local/var`, not the container path `/var/homelab-paas`; that translation is not implemented yet.
