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

Build the fixture image from the repository root, then start the bootstrap:

```sh
docker build -f services/test-service/Dockerfile -t test-service:local .
docker compose -f local/docker-compose.yaml up --build -d
```

Compose starts only Envoy and the control plane. The control plane deploys test-service itself through Docker Engine using its committed descriptor. Control-plane source is bind-mounted and Node watches for changes; `--experimental-transform-types` enables TypeScript constructor parameter properties in Node 24. Only Envoy publishes a port, on loopback port 80.

`services/paas/Dockerfile` uses Node 24 Alpine with separate build, production dependency installation, and runtime stages. The runtime image contains compiled JavaScript and production dependencies. Compose overrides its command to watch the mounted TypeScript source during local development.

- `etc/` maps to `/etc/homelab-paas` and holds `config.yaml` and the Envoy bootstrap `envoy.yaml`.
- `var/` maps to `/var/homelab-paas` and is ignored by Git. `docker compose down` retains it.
- The Docker socket is mounted for Engine integration.
- The repository is mounted read-only at `/mnt/repo`. The magic `remote: local` reads `/mnt/repo/services/test-service/test-service.sd.yaml` through Git at the checkout's `HEAD`. Commit descriptor edits before reconciliation can see them; other control-plane source edits reload immediately.
- Bootstrap containers carry cluster/role labels for network attachment. PaaS attaches itself and Envoy to each dedicated service network.
- Envoy's admin listener uses container port 9901 for configuration acceptance checks. It has no host port publication. Restart Envoy after changing its bootstrap configuration.

The control plane reads platform configuration at startup, serves `/health` internally on port 8080, and runs the [deployment MVP](configuration.md#implemented-deployment-mvp). Polling defaults in the checked-in local configuration are five seconds. The fixture descriptor already matches the MVP schema and explicitly uses `/health`. Auth, TLS, and advanced resources are omitted.

Check both the control plane and the deployed service through Envoy:

```sh
curl --fail http://localhost/health
curl --fail http://test-service.localhost/health
# If your resolver does not resolve *.localhost:
curl --fail --resolve test-service.localhost:80:127.0.0.1 http://test-service.localhost/health
```

Both checks return `{"status":"up"}` once the workload is ready. Envoy reads generated `cds.yaml` and `lds.yaml` from `local/var/_paas/`; deployment checkpoints and routes are YAML files beside them. No database is used. Stop or remove the managed workload to exercise recovery on the next poll. Restarting the control plane preserves the workload and routing state.

`docker compose down` stops only the bootstrap containers; Docker-managed workloads and their service networks remain. Workloads have no published ports. Advanced volume mounts remain deferred; when implemented, Docker bind sources must use absolute **host** paths, not container paths.
