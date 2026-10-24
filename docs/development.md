# Development

## Toolchain

Use the existing pnpm workspace and Node.js 24. The exact pnpm version is pinned by `packageManager` in the root `package.json`; `.nvmrc` supplies the local Node version.

The existing tooling is part of the stack:

- TypeScript with ES modules.
- Oxc's `oxlint` and `oxfmt`, using the checked-in configuration and lint rules.
- Vitest for tests.
- React and Vite for the [management UI](management-ui.md).

Keep versions and commands in their existing manifests and configuration files. Do not introduce a competing package manager, formatter, linter, or test runner.

## Workspace

| Path                         | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `services/paas/`             | TypeScript/Node.js control plane                              |
| `services/paas-ui/`          | Read-only management UI; see [its contract](management-ui.md) |
| `packages/shared-contracts/` | Public contracts shared by the control plane and UI           |
| `scripts/`                   | Repository tooling and development scripts                    |

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
| `pnpm test`                      | Build shared contracts and run workspace tests                                  |
| `pnpm build`                     | Build workspace packages                                                        |
| `pnpm image`                     | Build the control-plane Docker image tagged `homelab-paas/paas:dev`             |
| `pnpm dev:deploy`                | Build the control plane and start the local Compose bootstrap                   |

Run checks appropriate to the change. For code changes, use `pnpm check`, relevant tests, and `pnpm build` when build output or packaging is affected. For documentation-only changes, check formatting and relative links; application tests are unnecessary.

For the production installer, run `bash -n prod/install.sh` and `python3 -m unittest discover -s prod -p 'test_*.py'`. These standard-library tests use isolated temporary host paths, stub Git, and a pseudo-terminal to verify piped execution and hidden credential input; they require no network or root privileges. CI runs them alongside the workspace checks.

On macOS, `./scripts/bootstrap.sh` installs the tools in `Brewfile` and the pinned workspace dependencies. Add Homebrew's `node@24/bin` directory to your shell `PATH` and start Docker Desktop before running container commands. Kubernetes and appliance packaging scripts are no longer used.

## Backend infrastructure boundaries

Backend filesystem operations go through `services/paas/src/util/file.ts`, including Git and Envoy transports, stores, and startup wiring. Optional text reads return absence only for `ENOENT`; permission and other I/O failures propagate to the owning adapter for sanitized error translation. Binary reads preserve bytes. Atomic writes use an exclusively created, restricted, unique sibling file and rename, cleaning up temporary files after failure. Exclusive create-if-missing preserves existing discovery files. Callers create private directories with mode `0700`; private files default to `0600`. Existing files are not rewritten merely to initialize them.

YAML parsing and serialization use `util/yaml.ts`. Parsing rejects errors, duplicate keys and warnings, limits aliases, and excludes source excerpts from failures. This applies to configuration, descriptors, persisted YAML, and Envoy discovery. Tests also use these utilities; only the filesystem utility's own boundary tests use raw filesystem APIs to independently inspect bytes and permissions. Oxc enforces these import boundaries.

Services receive infrastructure effects through constructor contracts. Timers use injected `ISleep` from `util/sleep.ts`, including abortable delays for cancellation and deadlines. Concrete implementations are supplied by `start.ts`. Direct global `fetch` is permitted inside clients, infrastructure transports and the `util/healthcheck.ts` HTTP probe adapter, which belong to the client layer; injection remains available for testing. These adapters own protocol details, validation and sanitized failures; a generic HTTP wrapper adds no required boundary. The canonical logger is also an intentional shared dependency. Git retains its bounded, noninteractive `execFile` transport; do not build shell commands through a general subprocess helper.

Generic file key-value stores own serialization and key-to-path mapping. Domain stores own state validation and error translation, receive injected key-value stores, and keep filesystem paths out of services. The [persisted-state contract](reconciliation-and-deployments.md#implemented-deployment-mvp) remains compatible across this separation.

## Backend logging

The control plane writes Pino JSON lines to stdout with ISO UTC timestamps, numeric severity, and a message. Import `logger` or use `private readonly log = createLogger(Component.name)` from `services/paas/src/util/logger.ts`; child loggers add a stable `component` field. Source file/line stack inspection is intentionally omitted; component and event fields identify operations without per-log stack capture or production source maps.

Task runners establish AsyncLocalStorage context for each execution. Every nested log automatically receives `task` (the configured task name) and `taskId` (a fresh nanoid generated at execution, including retries). Supply the ID generator from the composition root. Queued task envelopes receive the execution ID when dispatched. Callers never pass tracing fields to log methods. Context remains isolated across overlapping runs and is restored when an execution finishes; failure reports run inside the same context.

Log detected drift and the resulting action, changed descriptor revisions, deployment outcomes, retry schedules/recovery, and certificate renewal. Successful unchanged polling passes and certificate checks stay silent. Koa logs method, path without query, status, and elapsed milliseconds; successful `/health` checks stay silent. Headers, bodies and raw request/response objects are excluded. Never log descriptors, environment values, credential material or raw infrastructure failures. Root `error`, `err`, and `command` fields are removed as a defensive measure; use fixed actionable summaries and safe identifiers.

## Continuous integration and image publishing

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, and pushed release tags matching `vX.X.X` (nonnegative integers without leading zeroes). Prerelease and build metadata suffixes are not supported. Other branch pushes do not trigger CI independently of a pull request.

Every run installs the pinned dependencies, runs `pnpm check` (formatting, linting, and typechecking), `pnpm test`, the production installer tests, and `pnpm build`, then builds the control-plane and test-service Docker images for `linux/amd64` and validates the local Compose configuration. The installer tests check the installed [production Quadlets](../prod/README.md). Publishing requires all these checks to pass.

Pull requests only build images. Pushes to `main` publish `ghcr.io/maxine4j/homelab-paas:<full-commit-sha>`. Release tag pushes publish the same image name with the exact Git tag, for example `ghcr.io/maxine4j/homelab-paas:v1.2.3`. The control-plane image has no `latest` tag. Both push events also publish `ghcr.io/maxine4j/homelab-paas/test-service` with `latest` and the first seven characters of the commit SHA as tags. Invalid release tags caught by the broad trigger fail before building or publishing.

Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`; no registry secret is required. The repository must be allowed to publish the GHCR package. Package visibility and deployment credentials for pulling private images are managed separately in GitHub. See [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Local container environment

Run `pnpm dev:deploy` from the repository root to build the control plane and start the bootstrap. It runs:

```sh
docker compose -f local/docker-compose.yaml up --build -d
```

Compose starts only Envoy and the control plane. The control plane deploys test-service itself through Docker Engine using its committed descriptor. Only Envoy publishes ports, on loopback ports 80 and 443.

The test-service descriptor uses `ghcr.io/maxine4j/homelab-paas/test-service:latest`, published by CI. The Docker host needs pull access to that package. Changes to content behind `latest` do not automatically redeploy an existing workload; see [image reconciliation](reconciliation-and-deployments.md#container-updates-and-images).

`services/paas/Dockerfile` uses Node 24 Alpine with separate build, production dependency installation, and runtime stages. Compose runs the same runtime image and default `node dist/main.js` command used in production, with compiled JavaScript and production dependencies. Source is not mounted into the application directory. Rerun `pnpm dev:deploy` to rebuild and replace the control plane after code or dependency changes.

Copy `local/.env.example` to `local/.env` and supply `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SIGNING_KEY` (at least 32 characters), `DIGITALOCEAN_API_TOKEN`, and `ACME_EMAIL`. Compose interpolates these values into the control-plane environment; they [override YAML credentials](configuration.md#implemented-deployment-mvp). The `.env` file is ignored by Git and excluded from Docker build contexts. Keep the signing key stable across redeployments to preserve sessions.

Local ingress uses `local.maxine4j.com` with HTTPS on port 443. Register `https://auth.local.maxine4j.com/auth/callback` in the GitHub OAuth application. Point the base domain and wildcard hostnames at `127.0.0.1` using DNS or local resolver configuration. The DigitalOcean token must manage the domain's DNS zone for certificate issuance.

- `etc/` maps to `/etc/homelab-paas` and holds `config.yaml` and the Envoy bootstrap `envoy.yaml`.
- `var/` maps to `/var/homelab-paas` and is ignored by Git. `docker compose down` retains it.
- The Docker socket is mounted for Engine integration.
- The repository is mounted read-only at `/mnt/repo`. The magic `remote: local` reads `/mnt/repo/services/test-service/test-service.sd.yaml` through Git at the checkout's `HEAD`. Commit descriptor edits before reconciliation can see them.
- Bootstrap containers carry cluster/role labels for network attachment. PaaS attaches itself and Envoy to each dedicated service network.
- Envoy's admin listener uses container port 9901 for configuration acceptance checks. It has no host port publication. Restart Envoy after changing its bootstrap configuration.
- Envoy retains UID 0 via `ENVOY_UID` to read the control plane's root-owned, restricted state and certificate files.

The control plane reads platform configuration at startup, serves `/health` internally on port 8080, and runs the [deployment MVP](configuration.md#implemented-deployment-mvp). Polling defaults in the checked-in local configuration are five seconds. The fixture descriptor already matches the MVP schema and explicitly uses `/health`. Local configuration enables GitHub auth and DigitalOcean TLS; advanced resources are omitted.

Check the control plane inside its container and the public deployed service through Envoy:

```sh
docker compose -f local/docker-compose.yaml exec -T paas node -e "fetch('http://127.0.0.1:8080/health').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })"
curl --fail https://test-service.local.maxine4j.com/health
# If local DNS is not configured:
curl --fail --resolve test-service.local.maxine4j.com:443:127.0.0.1 https://test-service.local.maxine4j.com/health
```

Both checks return `{"status":"up"}` once the workload is ready. Envoy reads generated `cds.yaml` and `lds.yaml` from `local/var/_paas/`; deployment checkpoints and routes are YAML files beside them. No database is used. Stop or remove the managed workload to exercise recovery on the next poll. Restarting the control plane preserves the workload and routing state.

For an end-to-end deployment check, also request `/ping` on `test-service.local.maxine4j.com` and expect `{"message":"pong"}`. Private ingress requires a browser login first. Record the workload ID and image with `docker inspect`, remove only that test-service container, and wait for reconciliation. Verify a new container ID uses the published test-service image, has no published ports, and serves both `/health` and `/ping` through Envoy. Check `local/var/_paas/test-service.state.yaml` reports `phase: ready` and the expected committed revision. Restart the control plane and repeat the requests; the replacement workload ID should remain unchanged.

### Local startup troubleshooting

Control-plane code, the built management UI, shared contracts and dependencies are baked into the image; rerun `pnpm dev:deploy` after changing them. A missing shared-contract export at startup can indicate an old image. Open `https://local.maxine4j.com` for the management UI and sign in through the existing GitHub flow. See [management UI](management-ui.md) for API, redaction and access semantics.

Legacy `local/var/_paas/routes.yaml` entries created before ingress policies were persisted lack `public`. The state store intentionally rejects these entries. Stop the control plane, add an explicit `public` value to each affected endpoint matching that service's committed descriptor, then restart the bootstrap. The checked-in test-service descriptor uses `public: true`. Do not infer public access for other services or delete persistent state to bypass validation. Private ingress requires configured auth and TLS.

`docker compose down` stops only the bootstrap containers; Docker-managed workloads and their service networks remain. Workloads have no published ports. Application [volume mounts](configuration.md#volumes-and-resource-limits) use arbitrary absolute **Docker host** paths. Provision sources on the host; a path visible only inside the control-plane container is not a host source. Service [secret files](configuration.md#environment-variables-and-secrets) belong under the mounted `etc/env/` directory and are reread during reconciliation.
