# Build tooling, CI, and image packaging

Status: agreed project specification. The control plane uses TypeScript, Node 24, Koa, and a top-level pnpm workspace. Ask the owner, with a recommendation, before adding any third-party dependency not already authorized.

Read when changing workspace scripts, toolchains, dependency integration, image packaging, or GitHub Actions. Running existing checks does not require this guide.

## Ownership and toolchains

- The root `package.json` owns repository commands; `pnpm-workspace.yaml` includes `packages/*` and `services/*`. Keep one committed root `pnpm-lock.yaml`, exact direct dependency versions, and the pinned pnpm `packageManager` field.
- Use Node 24, strict ESM TypeScript, Vitest for backend/shared/frontend tests, and the Oxc tools `oxlint` and `oxfmt` for linting and formatting. The root TypeScript configuration supplies shared strict settings; the SPA uses bundler resolution and DOM types.
- All workspace projects inherit strict checks, checked indexed access, exact optional properties, explicit overrides, complete returns, switch fallthrough checks, index-signature access checks, unused-code checks, side-effect import validation, and unreachable-code/label checks. Isolated modules and erasable syntax keep development compatible with Node's native TypeScript stripping; builds do not emit on errors. Keep `skipLibCheck` enabled for the pinned Vitest/Chai and Vite/Rollup declaration conflicts; application source remains fully checked.
- Recursive type definitions are forbidden. The local Oxlint plugin in `scripts/lint-rules.mjs` rejects direct and mutual alias/interface recursion within a module; `import/no-cycle` includes type imports to reject cycles across modules. Prefer explicit finite types over recursive helpers such as `DeepReadonly`. `pnpm test:tooling` runs the rule's Vitest fixtures and real-linter integration test as part of `pnpm test`.
- Node's built-in TypeScript stripping supports small development/build scripts. Production runs compiled JavaScript; do not add a runtime TypeScript loader or another repository task orchestrator.
- `pnpm install --frozen-lockfile` prepares dependencies. Build/check/test scripts do not install dependencies or contact external services.
- Shared TypeScript contracts in `packages/shared-contracts/src/index.ts` are canonical and are compiled directly, without code generation. Both services depend on that package through `workspace:*`; never copy wire types or import backend adapters into the browser. Use Zod at untrusted runtime boundaries.
- Compiled packages and the SPA use ignored `dist/` directories. Build shared contracts before compiling consumers. A backend-only build requires the shared package but no frontend build.
- Root `pnpm build` runs workspace packages in dependency order. `pnpm check` runs format, lint, and type checks; `pnpm test` runs Vitest across packages with runtime tests. Unit tests never start Docker or k3d.
- Use `pnpm format` to format the repository, and `pnpm dev` for the backend and Vite development servers. Vite proxies API requests to the backend.

## Shared contracts

The initial types are a `CredentialReference` string and `ApiError` objects with closed error/diagnostic codes. Types alone do not validate runtime input; adapters must validate untrusted values with Zod. Errors expose controlled field paths and stable codes, never rejected values or resolved credentials.

Compiler fixtures in the SPA check valid and invalid uses of the shared types. Type-only contracts do not need runtime unit tests; test runtime validation at the adapter boundary. String-length constraints require runtime validation. Descriptor parsing remains future work.

## Image packaging

`deploy/appliance/Dockerfile` builds the shared package, backend and SPA with the locked workspace, then packages production dependencies, compiled JavaScript, Node 24, and the SPA at `/usr/share/homelab-paas/ui`. It builds native filesystem dependencies for the target Linux architecture, never copies a macOS native module, and runs as UID/GID 65532. Pin the multiarchitecture Node base-image digest. The image contains the Node runtime and its trust roots; development tools are excluded from its final stage.

`pnpm image` invokes `scripts/build-image.py` and Docker Buildx to export a Linux OCI archive under `artifacts/` without loading or publishing it. This explicit command requires Docker/Buildx. It creates or reuses the named `homelab-paas-build` builder with the supported `docker-container` driver and preserves the user's default builder. `--arch amd64` or `--arch arm64` selects the target; the default matches the host. Loading, privileged tests, deployment, and publication are separate explicit actions. Normal builds and checks do not use Docker.

The MVP image is the inner control-plane workload, not the future production outer K3s appliance. When that appliance exists, embed/import the workload image and keep it, the SPA, and the supervisor on one release revision. Verify the packaged `index.html` and referenced assets. Do not claim privileged appliance acceptance from unit tests.

## Local development and CI

`scripts/bootstrap.sh` installs macOS prerequisites from the Brewfile and the locked workspace dependencies. The approved Koffi dependency supplies typed POSIX bindings for secure directory-relative operations and OS locks, replacing separate lock-only bindings. Its install uses supported prebuilt binaries where available; building from source requires Xcode Command Line Tools locally or the compiler in the image build stage.

`pnpm dev:deploy` reuses a dedicated single-server `homelab-paas-dev` k3d cluster, builds/loads/imports a content-tagged Linux workload image, applies the local manifests, and waits for readiness. It retains loopback-only ports, a dedicated kubeconfig, and the pinned local K3s version. It never mounts the host Docker socket into workloads.

GitHub Actions installs pinned Node/pnpm, installs with the frozen lock, and runs `pnpm check`, `pnpm test`, and `pnpm build`. A separate packaging job builds the Linux OCI archive, checks its bundle, explicitly loads an image, and runs `deploy/appliance/smoke.mjs` inside a read-only container with no external network. That smoke test verifies packaged Koa HTTP routing and graceful SIGTERM. Privileged production-appliance acceptance and publication require dedicated jobs; never run untrusted pull-request code on privileged runners with production secrets.

## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Node filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- [Koa](https://koajs.com/)
- [Oxc](https://oxc.rs/)
- [Vitest](https://vitest.dev/)
