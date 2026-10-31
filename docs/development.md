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

| Command                          | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install pinned dependencies                                                      |
| `pnpm dev`                       | Build shared contracts and start the control plane and UI development processes  |
| `pnpm format:check`              | Check formatting                                                                 |
| `pnpm format`                    | Apply formatting                                                                 |
| `pnpm lint`                      | Run Oxc lint checks with warnings treated as errors                              |
| `pnpm typecheck`                 | Build shared contracts and typecheck workspace packages                          |
| `pnpm check`                     | Run formatting, lint, and type checks                                            |
| `pnpm test`                      | Build shared contracts and run workspace tests                                   |
| `pnpm test:integration`          | Run in-process backend integration scenarios with real local transports          |
| `pnpm test:e2e`                  | Run Playwright against built images, real Docker and Envoy                       |
| `pnpm test:containers`           | Run integration/E2E with a private Docker Engine in a disposable Linux container |
| `pnpm build`                     | Build workspace packages                                                         |
| `pnpm image`                     | Build the control-plane Docker image tagged `homelab-paas/paas:dev`              |
| `pnpm dev:deploy`                | Build the control plane and start the local Compose bootstrap                    |

Run checks appropriate to the change. For code changes, use `pnpm check`, relevant tests, and `pnpm build` when build output or packaging is affected. For documentation-only changes, check formatting and relative links; application tests are unnecessary.

For the production installer and [upgrade helper](../prod/upgrade.md), run `bash -n prod/install.sh && bash -n prod/upgrade-paas.sh` and `python3 -m unittest discover -s prod -p 'test_*.py'`. These standard-library tests use isolated temporary host paths, stub Git and Docker, and a pseudo-terminal to verify piped installation and hidden credential input; they require no network or root privileges. CI runs them alongside the workspace checks.

On macOS, `./scripts/bootstrap.sh` installs the tools in `Brewfile` and the pinned workspace dependencies. Add Homebrew's `node@24/bin` directory to your shell `PATH` and start Docker Desktop before running container commands. Kubernetes and appliance packaging scripts are no longer used.

For UI design with mock data, run `pnpm --filter @homelab-paas/ui dev --mode mock` and open the Vite URL. This opts into static read-only HTTP snapshots in the development server with Paperless resource, container, event and log fixtures. Normal development proxies HTTP and WebSocket upgrades to the control plane; production uses the [live management protocol](management-ui.md#live-subscriptions). Production builds do not serve mock API routes.

Proxying does not bypass management authentication or origin checks: live connections and mutations require the browser origin to match the configured management origin. Use mock mode for isolated UI design, or the configured management hostname through Envoy for authenticated end-to-end development.

## Build metadata

The management UI embeds `BUILD_SHA` during the Vite build and displays it in its footer. CI supplies the full `GITHUB_SHA` through the control-plane Docker build argument `BUILD_SHA`, including when publishing images from `main` or release tags. This identifies the source commit independently of the image tag and requires no runtime environment variable or API call. The Docker build context excludes `.git`.

For a local image with revision metadata, run `docker build --build-arg BUILD_SHA="$(git rev-parse HEAD)" -f services/paas/Dockerfile -t homelab-paas/paas:dev .`. For a local UI build or dev server, prefix its pnpm command with `BUILD_SHA="$(git rev-parse HEAD)"`. Omitted or empty metadata displays `Build unknown`.

## Backend infrastructure boundaries

Backend filesystem operations go through `services/paas/src/util/file.ts`, including Git and Envoy transports, stores, and startup wiring. Optional text reads return absence only for `ENOENT`; permission and other I/O failures propagate to the owning adapter for contextual error translation with the original `cause`. Binary reads preserve bytes. Atomic writes use an exclusively created, restricted, unique sibling file and rename, cleaning up temporary files after failure. Exclusive create-if-missing preserves existing discovery files. Callers create private directories with mode `0700`; private files default to `0600`. Existing files are not rewritten merely to initialize them.

YAML parsing and serialization use `util/yaml.ts`. Parsing rejects errors, duplicate keys and warnings, limits aliases, and retains parser failures as causes beneath a contextual message and file location. This applies to configuration, descriptors, persisted YAML, and Envoy discovery. Tests also use these utilities; only the filesystem utility's own boundary tests use raw filesystem APIs to independently inspect bytes and permissions. Oxc enforces these import boundaries.

Services receive infrastructure effects through constructor contracts. Timers use injected `ISleep` from `util/sleep.ts`, including abortable delays for cancellation and deadlines. Concrete implementations are supplied by `start.ts`. Direct global `fetch` is permitted inside clients, infrastructure transports and the `util/healthcheck.ts` HTTP probe adapter, which belong to the client layer; injection remains available for testing. These adapters own protocol details, validation and sanitized failures; a generic HTTP wrapper adds no required boundary. The canonical logger is also an intentional shared dependency. Git retains its bounded, noninteractive `execFile` transport; do not build shell commands through a general subprocess helper.

Generic file key-value stores own serialization and key-to-path mapping. Domain stores own state validation and error translation, receive injected key-value stores, and keep filesystem paths out of services. The [persisted-state contract](reconciliation-and-deployments.md#implemented-deployment-mvp) remains compatible across this separation.

Private Git sources use the existing Git/OpenSSH runtime tools. Put deploy keys under `/etc/homelab-paas/keys/` by default, or mount another host location into the control plane. The local bootstrap maps `local/etc/keys/` to that default directory. SSH automatically accepts new host keys and persists them in each Git cache. See the authoritative [Git credential contract](configuration.md#private-git-repositories) for path, protocol, token and host-key semantics.

## Backend logging

The control plane writes Pino JSON lines to stdout with ISO UTC timestamps, numeric severity, and a message. Import `logger` or use `private readonly log = createLogger(Component.name)` from `services/paas/src/util/logger.ts`; child loggers add a stable `component` field. Source file/line stack inspection is intentionally omitted; component and event fields identify operations without per-log stack capture or production source maps.

Task runners establish AsyncLocalStorage context for each execution. Every nested log automatically receives `task` (the configured task name) and `taskId` (a fresh nanoid generated at execution, including retries). Supply the ID generator from the composition root. Queued task envelopes receive the execution ID when dispatched. Callers never pass tracing fields to log methods. Context remains isolated across overlapping runs and is restored when an execution finishes; failure reports run inside the same context.

Log detected drift and the resulting action, changed descriptor revisions, deployment outcomes, retry schedules/recovery, and certificate renewal. Successful unchanged polling passes and certificate checks stay silent. Koa logs method, path without query, status, elapsed milliseconds, and caught failures; successful `/health` checks stay silent. Request logging records outcomes rather than dumping request/response objects.

Operator logs do not redact error fields, commands, or failure details. Log caught failures under `err` with an actionable message and operation identifiers. Error wrappers preserve the original failure using `new Error(message, { cause })` or `ErrorOptions` on typed errors. Pino serializes `err`, `error`, and `failure` with type, message, enumerable properties, structured nested causes, and a combined stack containing the cause chain. HTTP adapter failures retain response status and error body; YAML and schema failures retain parser diagnostics. Non-Error rejections retain their original value. Logs can therefore contain credentials or other sensitive material present in failures. API/UI response redaction and sanitized persisted status messages remain separate contracts.

Fatal process failures use the same serialization under `failure` and shut down the process with exit code 1.

## Continuous integration and image publishing

The reusable [CI workflow](../.github/workflows/ci.yml) runs directly on pull requests. The separate [publish workflow](../.github/workflows/publish.yml) runs on pushes to `main` and pushed release tags matching `vX.X.X` (nonnegative integers without leading zeroes), calling the full CI workflow with image publishing enabled. Publishing is disabled by default and restricted to push events. Prerelease and build metadata suffixes are not supported. Other branch pushes do not trigger CI independently of a pull request.

Every run validates the release tag, then runs independent checks: Docker Build (test-service), Docker Build (control-plane), Metrics images and collection, E2E test, Typecheck, Linting & formatting, Unit tests, Integration tests, and Installer checks. Node jobs use the shared workspace setup action to install pinned dependencies. There is no separate workspace build job: the Dockerfiles build the project. The E2E job builds its own control-plane and test-service Docker images for `linux/amd64`, validates the local and [production](../prod/README.md) Compose configurations, and runs E2E tests. Integration and E2E jobs use separate disposable Docker daemons and retain separate diagnostics artifacts. The metrics job builds the three custom images and runs `sh scripts/test-metrics-images.sh` in its own disposable Engine, checking fresh-data Grafana provisioning/plugin loading, discovery across separate networks, actual metrics/log ingestion, and collector restart with persisted state. It retains its own diagnostics. The optional publish job inside the CI workflow waits for tag validation and every check except E2E, then checks out the same commit, rebuilds all five custom Docker images for `linux/amd64`, and pushes them directly to GHCR. Images are not transferred between jobs as artifacts. E2E still runs and reports failures, but publication neither waits for it nor depends on its result. Failures in the other checks prevent publication; pull requests run the same checks without publishing.

Pull requests validate images without publishing. Pushes to `main` publish `ghcr.io/maxine4j/homelab-paas:<full-commit-sha>`. Release tag pushes publish the same image name with the exact Git tag, for example `ghcr.io/maxine4j/homelab-paas:v1.2.3`. The control-plane image has no `latest` tag. Both push events also publish `ghcr.io/maxine4j/homelab-paas/test-service` with `latest` and the first seven characters of the commit SHA as tags. Invalid release tags caught by the broad trigger fail before building or publishing.

The custom [observability images](../services/paas-metrics/README.md) publish as `ghcr.io/maxine4j/homelab-paas/metrics-grafana`, `metrics-victoriametrics`, and `metrics-telegraf` under the same namespace. Every publication includes the full commit SHA; `main` also updates `latest`, while release pushes add the exact release tag without moving `latest`. Their configuration and the Grafana datasource plugin are baked in at build time.

Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`; no registry secret is required. The repository must be allowed to publish the GHCR package. Package visibility and deployment credentials for pulling private images are managed separately in GitHub. See [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Integration and E2E tests

Ordinary `pnpm test` selects source unit tests and backend test-utility unit tests explicitly. `pnpm test:integration` selects `services/paas/tests/integration/` with Vitest. These scenarios compose real services, stores, Git, JWT, routers and clients within the test process. Small typed mocks serve GitHub, DigitalOcean and Envoy over HTTP and the focused Docker Engine endpoints over a Unix socket. They validate captured request parameters and meaningful ordering, and fail teardown on unexpected traffic. They do not globally replace fetch or emulate complete external systems.

Direct integration needs Git, OpenSSL and permission to open local HTTP/Unix-socket listeners; the private Linux runner supplies these tools for containerized runs. E2E additionally needs Docker Engine/Compose and the three test images below. Run `nvm use` first, then:

```sh
pnpm install --frozen-lockfile
pnpm test:integration
docker build -f services/paas/Dockerfile -t homelab-paas/paas:ci .
docker build -f services/test-service/Dockerfile -t homelab-paas/test-service:ci .
version=$(pnpm --filter @homelab-paas/paas exec node -p "require('@playwright/test/package.json').version")
docker build -f services/paas/tests/fixtures/browser.Dockerfile --build-arg "PLAYWRIGHT_VERSION=$version" -t homelab-paas/playwright:ci .
pnpm test:containers
```

`PAAS_IMAGE`, `TEST_SERVICE_IMAGE` and `PLAYWRIGHT_IMAGE` can select existing images. Each test creates unique `:local` workload/control-plane aliases, a cluster ID, bare Git remote, committed descriptors, configuration, restricted state and test CA under ignored `artifacts/`. Absolute remote bind paths match inside the control-plane container. Fixtures are independent of `local/.env` and operator credentials. Tests poll observable routing/checkpoints with deadlines, without startup sleeps or blanket retries. Cluster mutations run serially; browser contexts and mocks are fresh per test.

`pnpm test:containers` is the CI and cross-platform path. It builds a Linux Node 24 test runner from the current checkout, starts its own Docker 28 daemon in a privileged container, and streams the already built images into that daemon using Docker save/load. Tests and dockerd share a filesystem and network namespace, so inner bind paths and loopback ingress work identically on Docker Desktop and Linux. The outer host Docker socket is never mounted. The private Engine has its own disposable data volume; test artifacts are the only host bind mount. Teardown removes that runner, its anonymous Engine volume and its temporary image, including after test failure. This isolates Docker objects and image state, not the host kernel or resource capacity. Docker-in-Docker [requires privileged mode](https://github.com/docker-library/docs/blob/master/docker/README.md); it is intended for trusted repository tests, not a security sandbox.

Use `pnpm test:containers integration` for containerized integration only, or `pnpm test:containers e2e --grep production` for a focused E2E run. For fast host iteration, `pnpm test:integration` and `pnpm test:e2e` remain available. Direct E2E uses the selected host Engine with cluster-scoped cleanup; on Linux its user must be able to read the restricted state created by container root. The private runner avoids that host UID difference and returns artifact ownership to the invoking user. Integration mocks still run in the Vitest process inside the runner; they do not need nested Docker APIs.

Playwright runs HTTP deployment assertions and browser OAuth scenarios. Compose starts real Envoy and the built control-plane image; Docker Engine creates the workloads and service networks. OAuth uses the mounted `tests/bootstrap.mjs` entrypoint with constructor endpoint overrides and the shared process lifecycle. Mock GitHub listens in the test-runner process and is reachable from both control-plane and browser containers through `host.docker.internal`. In private runs, this resolves to the runner's own network namespace. A separate production startup scenario keeps the image's exact normal command, supplies a valid local session, and verifies deployment, authenticated routing, graceful shutdown and fatal startup without endpoint overrides.

Ingress uses a generated base-domain/wildcard certificate signed by a private test CA. HTTPS observations verify that CA and the requested hostname. Chromium runs in an isolated Linux image with its own NSS trust database containing the CA, including on macOS hosts. Browser resolution maps only the test domain to that cluster's Envoy. No host trust-store changes, live DNS, ACME, GitHub, DigitalOcean, registry credentials or TLS-validation bypasses are needed. The browser image version must match the pinned Playwright dependency. See [Chromium's NSS certificate management](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md) and [Playwright's remote Docker browser support](https://playwright.dev/docs/docker#remote-connection).

Tests retain diagnostics before teardown: Compose/workload logs, scoped Docker inspection/network inventory, Envoy config dump, captured GitHub requests, deployment checkpoints, discovery files and routes. Failure traces and the HTML report live in `artifacts/playwright/` for direct runs, or `artifacts/paas-tests-*/playwright/` for private-runner runs; CI uploads `artifacts/` for seven days. Private runs also retain daemon logs and final Docker/network inventory. These artifacts include test keys/tokens and are test-only data. Teardown stops reconciliation, removes only this cluster's labelled containers and service networks, and drops its image aliases. Compose down alone cannot clean up directly managed workloads. If interrupted before cleanup, inspect the recorded cluster ID for direct runs or the outer `homelab-paas.test-run` label for private runs and remove only those objects, including the private runner's anonymous volume.

The DNS integration scenario exercises real DigitalOcean HTTP requests and certificate publication with an injected ACME SDK boundary. It does not prove live DNS propagation or full ACME issuance. Mock Docker/Envoy integration checks do not prove real deployment/routing; the E2E suite covers those boundaries. Live GitHub and certificate issuance remain separate staging checks.

## Local container environment

Run `pnpm dev:deploy` from the repository root to build the control plane and start the bootstrap. It runs:

```sh
docker compose -f local/docker-compose.yaml up --build -d
```

Compose starts only Envoy and the control plane. The control plane deploys test-service itself through Docker Engine using its committed descriptor. Only Envoy publishes ports, on loopback ports 80 and 443.

The local bootstrap targets Docker Desktop on macOS and uses its default security options. The production bootstrap configures SELinux access for the Docker socket and shared state; see [production deployment](../prod/README.md#prepare-the-host).

The test-service descriptor uses `ghcr.io/maxine4j/homelab-paas/test-service:latest`, published by CI. The Docker host needs pull access to that package. Changes to content behind `latest` do not automatically redeploy an existing workload; see [image reconciliation](reconciliation-and-deployments.md#container-updates-and-images).

`services/paas/Dockerfile` uses Node 24 Alpine with separate build, production dependency installation, and runtime stages. Compose runs the same runtime image and default `node dist/main.js` command used in production, with compiled JavaScript and production dependencies. Source is not mounted into the application directory. Rerun `pnpm dev:deploy` to rebuild and replace the control plane after code or dependency changes.

Copy `local/.env.example` to `local/.env` and supply `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SIGNING_KEY` (at least 32 characters), `DIGITALOCEAN_API_TOKEN`, and `ACME_EMAIL`. Compose interpolates these values into the control-plane environment; they [override YAML credentials](configuration.md#implemented-deployment-mvp). The `.env` file is ignored by Git and excluded from Docker build contexts. Keep the signing key stable across redeployments to preserve sessions.

Local ingress uses `local.maxine4j.com` with HTTPS on port 443. Register `https://auth.local.maxine4j.com/auth/callback` in the GitHub OAuth application. Point the base domain and wildcard hostnames at `127.0.0.1` using DNS or local resolver configuration. The DigitalOcean token must manage the domain's DNS zone for certificate issuance.

- `etc/` maps to `/etc/homelab-paas` and holds `config.yaml` and the Envoy bootstrap `envoy.yaml`. The control plane mounts this directory writable for [management edits](configuration.md#management-edits); Envoy retains read-only access. Recreate existing bootstrap containers to apply the changed mount permissions.
- `var/` maps to `/var/homelab-paas` and is ignored by Git. `docker compose down` retains it.
- The Docker socket is mounted for Engine integration.
- The repository is mounted read-only at `/mnt/repo`. The magic `remote: local` reads `/mnt/repo/services/test-service/test-service.sd.yaml` through Git at the checkout's `HEAD`. Commit descriptor edits before reconciliation can see them.
- Bootstrap containers carry cluster/role labels for network attachment. PaaS attaches itself and Envoy to each dedicated service network.
- Envoy's admin listener uses container port 9901 for configuration acceptance checks. It has no host port publication. Restart Envoy after changing its bootstrap configuration.
- Envoy retains UID 0 via `ENVOY_UID` to read the control plane's root-owned, restricted state and certificate files.

The control plane reads platform configuration at startup and [reloads it every minute](configuration.md#platform-configuration-reload), serves `/health` internally on port 8080, and runs the [deployment MVP](configuration.md#implemented-deployment-mvp). Health, secrets and retry reconciliation always run every five seconds. Remote Git refresh uses the single `git.pollIntervalSeconds` setting, defaulting to five minutes; local Git sources continue reading committed refs on each reconciliation pass. The fixture descriptor already matches the MVP schema and explicitly uses `/health`. Local configuration enables GitHub auth and DigitalOcean TLS; advanced resources are omitted.

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

`docker compose down` stops only the bootstrap containers; Docker-managed workloads and their service networks remain. Workloads have no published ports unless explicitly configured with [host ports](configuration.md#host-ports). Application [volume mounts](configuration.md#volumes-and-resource-limits) use arbitrary absolute **Docker host** paths. Provision sources on the host; a path visible only inside the control-plane container is not a host source. Service [secret files](configuration.md#environment-variables-and-secrets) belong under the mounted `etc/env/` directory and are reread during reconciliation.
