# Homelab PaaS — agent instructions

## Working rules

- Use strict ESM TypeScript on Node 24. Prefer discriminated unions, typed errors, and explicit operation results over stringly typed state or broad optional fields. Never use `any`; narrow `unknown` at untrusted boundaries. Prefer `array.at(index)` for array reads.
- Keep imports at the top of the file, using `import type` for types. Do not use inline import types such as `import("node:http").IncomingHttpHeaders`. Dynamic imports require a concrete reason, such as deliberate asynchronous module loading.
- Use Koa for HTTP and Pino for structured logging. Reuse clients/connections, set timeouts, redact credentials, and restrict redirects where credentials are involved. Include operation/service/resource/revision identifiers in logs; avoid ad hoc stdout logging in application code.
- All control-plane backend source changes must follow [Layered architecture](docs/layered-architecture.md).
- Use maintained asynchronous OAuth2, ACME, and Kubernetes clients with the specified GitHub and Let's Encrypt semantics. Ask the owner, with your recommendation, before adding a third-party dependency they have not authorized; do not invent protocol implementations to avoid this discussion.
- Use AbortSignal cancellation, bounded queues/concurrency, timers, and graceful shutdown. Put synchronous disk and serialization work in dedicated workers; do not block the request event loop.
- Use the top-level pnpm workspace for repository commands, Vitest for all TypeScript tests, and Oxc's oxlint/oxfmt for linting/formatting. Keep one root lockfile and exact dependency pins.
- Use explicit resource variants, operation results, and public errors. Apply timeouts, cancellation, bounded concurrency, and retry policies appropriate to the operation.
- Make filesystem writes atomic and reconciliation restart-safe. Handle signals and graceful shutdown explicitly.
- Avoid shell interpolation for Git, Docker, database, or filesystem operations. Prefer structured APIs or argument-array process calls.
- Prefer maintained libraries for protocols and infrastructure integration. New dependencies need a concrete purpose; avoid duplicate frameworks and protocol implementations.
- Keep public product flows focused on service intent. Kubernetes internals belong in diagnostics and operator documentation.
- Communicate tersely and challenge inconsistent requirements. Ask the owner about unresolved product decisions rather than inventing behaviour.
- Use `apply_patch` for repository edits when available. If a required tool fails, diagnose it or ask for help; do not substitute an unreliable workaround.

## Essential constraints

- Build one self-hosted Linux appliance: systemd → outer Docker container → one K3s node. Workloads use the nested runtime, never the host Docker socket.
- Local development uses Docker and a reusable single-server k3d cluster. Keep this separate from the production appliance lifecycle; never mount the host Docker socket into workloads.
- One TypeScript/Node 24/Koa control plane owns platform integration; React/TypeScript/Vite supplies the SPA. Shared TypeScript contracts are canonical; do not generate them from JSON Schemas. Validate untrusted inputs at runtime with Zod.
- pnpm owns repository builds, tests, and explicit image packaging commands. Do not add a competing top-level task runner.
- Discovery is read-only. Only an administrator's explicit per-descriptor enrollment authorizes deployment; updates use Git polling, never webhooks.
- Require host-file TLS/OAuth2/access/discovery configuration before management login. No unauthenticated bootstrap or first-visitor administration.
- Web resources are private by default. Private-application and administrator allowlists are independent; management always requires administrator access. Auth failures deny protected traffic.
- Only the platform owns ingress, TLS, and network policy. Descriptors cannot elevate privileges, select arbitrary host paths, or consume platform secrets.
- Keep secrets out of Git, API responses, and logs. Preserve data and stable credentials on removal; destructive purge requires an explicit administrator action.
- Keep application desired state in Git and canonical cluster configuration on the host. Do not create conflicting UI overrides or silently seize unrelated Kubernetes objects.
- Store controller metadata in one atomic versioned YAML snapshot at `_platform/state/controller.yaml`, with a lifetime OS lock on the stable `_platform/state/controller.lock` inode. No SQLite or controller database server. Follow the configuration/storage guide for durable commits, migrations, and recovery.
- Allocate one namespace per enrolled service, with separate platform/observability namespaces and no CRDs. Use durable inventory and owned-field apply without forced adoption; ordinary cleanup retains namespaces, data, credentials, and identity reservations.

## Read only the relevant guides

The linked specifications are binding. Read the guide for the task before changing that area; follow related links only for affected boundaries. Requirements and confirmed decisions are settled. Recommendations remain recommendations until recorded in an ADR; ask about unresolved decisions rather than inventing them.

| Task                                                                                               | Guide                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Product scope, architecture, appliance lifecycle, workspace layout, release acceptance             | [Platform specification](docs/platform-spec.md)                |
| Any control-plane backend source change                                                            | [Layered architecture](docs/layered-architecture.md)           |
| Descriptor schemas, validation/defaults, resource catalog, shared contracts                        | [Descriptors](docs/descriptors.md)                             |
| GitHub discovery, enrollment, source tracking, polling                                             | [GitOps](docs/gitops.md)                                       |
| Planning, Kubernetes ownership, deployment, network permissions, observability                     | [Reconciliation](docs/reconciliation.md)                       |
| OAuth2, sessions, authorization, routing, DNS, TLS                                                 | [Access and ingress](docs/access-and-ingress.md)               |
| Host configuration, secrets, state, storage, retention, backups                                    | [Configuration and storage](docs/configuration-and-storage.md) |
| UI, management API, onboarding, backend static-file serving                                        | [Frontend and API](docs/frontend.md)                           |
| Changes to pnpm workspace scripts, toolchains, dependencies, generation, packaging, GitHub Actions | [Build and CI](docs/build-and-ci.md)                           |

## Commands and repository status

The repository implements the hello-world/healthcheck MVP, shared contracts, host configuration, controller persistence, TypeScript/Vite builds, a control-plane OCI image, and a reusable local k3d deployment. Descriptor parsing, the production outer appliance, and management features remain future work. See [README](README.md) for setup and development commands.

Use `pnpm check`, `pnpm test`, and `pnpm build` for routine verification. `scripts/bootstrap.sh` installs macOS development dependencies; `pnpm image` assembles the Linux OCI archive; `pnpm dev:deploy` builds and deploys repeatedly to the same local k3d cluster. Running declared checks does not require loading the build guide. Read that guide when changing build machinery itself. Keep Docker/k3d execution, privileged appliance acceptance, and image publication explicit and separate from ordinary verification.
