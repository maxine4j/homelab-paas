# Homelab PaaS — agent instructions

## Working rules

- Use rustfmt and Clippy for Rust. Prefer explicit enums, typed errors, `Result`, and clear ownership over stringly typed state or broad optional fields. Do not use panics, `unwrap`, or `expect` for recoverable production failures.
- Use Axum/Tower on Tokio for HTTP. Prefer asynchronous `reqwest` clients with Rustls and the Tokio-compatible `kube` client/runtime. Reuse clients and connection pools, set timeouts, and restrict redirects where credentials are involved.
- Use maintained asynchronous Rust OAuth2 and ACME clients, with the same GitHub and Let's Encrypt product semantics already specified. Concrete crate versions and compatibility are pinned when bootstrapping the workspace.
- Use `tracing` spans/events and `tracing-subscriber` for structured logging. Include operation/service/resource/revision identifiers and redact credentials. Avoid ad hoc stdout logging in application code.
- Use Tokio cancellation, bounded channels/concurrency, timers, and graceful task shutdown. Do not block async executor threads with synchronous disk, Git, or CPU-heavy operations; use appropriate async APIs or bounded blocking tasks.
- Use Bazel for repository-wide commands. Do not add a second top-level pnpm/Cargo task runner, Cargo wrappers for JavaScript packages, or an image-build crate.
- Use explicit resource variants, operation results, and public errors. Apply timeouts, cancellation, bounded concurrency, and retry policies appropriate to the operation.
- Make filesystem writes atomic and reconciliation restart-safe. Handle signals and graceful shutdown explicitly.
- Avoid shell interpolation for Git, Docker, database, or filesystem operations. Prefer structured APIs or argument-array process calls.
- Prefer maintained libraries for protocols and infrastructure integration. New dependencies need a concrete purpose; avoid duplicate frameworks and protocol implementations.
- Keep public product flows focused on service intent. Kubernetes internals belong in diagnostics and operator documentation.
- Communicate tersely and challenge inconsistent requirements. Ask the owner about unresolved product decisions rather than inventing behaviour.
- Use `apply_patch` for repository edits when available. If a required tool fails, diagnose it or ask for help; do not substitute an unreliable workaround.

## Essential constraints

- Build one self-hosted Linux appliance: systemd → outer Docker container → one K3s node. Workloads use the nested runtime, never the host Docker socket.
- One Rust/Axum/Tokio control plane owns platform integration; React/TypeScript/Vite supplies the SPA. Shared Rust/Serde contracts are canonical.
- Bazel owns repository builds, tests, code generation, and image packaging. Cargo and frontend-local pnpm support language development.
- Discovery is read-only. Only an administrator's explicit per-descriptor enrollment authorizes deployment; updates use Git polling, never webhooks.
- Require host-file TLS/OAuth2/access/discovery configuration before management login. No unauthenticated bootstrap or first-visitor administration.
- Web resources are private by default. Private-application and administrator allowlists are independent; management always requires administrator access. Auth failures deny protected traffic.
- Only the platform owns ingress, TLS, and network policy. Descriptors cannot elevate privileges, select arbitrary host paths, or consume platform secrets.
- Keep secrets out of Git, API responses, and logs. Preserve data and stable credentials on removal; destructive purge requires an explicit administrator action.
- Keep application desired state in Git and canonical cluster configuration on the host. Do not create conflicting UI overrides or silently seize unrelated Kubernetes objects.

## Read only the relevant guides

The linked specifications are binding. Read the guide for the task before changing that area; follow related links only for affected boundaries. Requirements and confirmed decisions are settled. Recommendations remain recommendations until recorded in an ADR; ask about unresolved decisions rather than inventing them.

| Task | Guide |
| --- | --- |
| Product scope, architecture, appliance lifecycle, workspace layout, release acceptance | [Platform specification](docs/platform-spec.md) |
| Descriptor schemas, validation/defaults, resource catalog, shared contracts | [Descriptors](docs/descriptors.md) |
| GitHub discovery, enrollment, source tracking, polling | [GitOps](docs/gitops.md) |
| Planning, Kubernetes ownership, deployment, network permissions, observability | [Reconciliation](docs/reconciliation.md) |
| OAuth2, sessions, authorization, routing, DNS, TLS | [Access and ingress](docs/access-and-ingress.md) |
| Host configuration, secrets, state, storage, retention, backups | [Configuration and storage](docs/configuration-and-storage.md) |
| UI, management API, onboarding, backend static-file serving | [Frontend and API](docs/frontend.md) |
| Changes to Bazel, toolchains, dependencies, generation, packaging, GitHub Actions | [Build and CI](docs/build-and-ci.md) |

## Commands and repository status

This repository currently contains the specification only. Build targets and source code are not implemented; do not present proposed commands as working commands.

Once implemented, use the repository's declared Bazel targets for routine builds, checks, and tests. Running those commands to validate a feature does not require loading the build guide. Read that guide when changing the build machinery itself. Keep privileged appliance acceptance and image publication explicit and separate from ordinary verification.
