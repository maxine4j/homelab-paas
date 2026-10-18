# Build tooling, CI, and image packaging

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing Bazel rules/targets, toolchains, dependency integration, contract generation, image packaging, or GitHub Actions workflows. Running existing build/test commands for another task does not require this guide.

Read related requirements only when the change crosses those boundaries: [platform architecture and target workspace layout](platform-spec.md), [frontend](frontend.md).

## Build ownership and image packaging

- Use Bazel with Bzlmod, `rules_rust`, `rules_js`, and `rules_oci`. Pin Bazel, rule sets, toolchains, dependency locks, and OCI base-image digests.
- Bazel targets are authoritative for CI and release builds. Cargo and pnpm remain language-specific dependency/development tools, not competing repository orchestrators.
- Use a Cargo workspace for the backend and shared-contracts crates. Import its manifests and committed `Cargo.lock` through `rules_rust` crate-universe support; do not maintain a separate conflicting list of Rust dependency versions.
- Keep the SPA's `package.json`, committed `pnpm-lock.yaml`, JavaScript build dependencies, and frontend configuration in `services/paas-ui`. Import `//services/paas-ui:pnpm-lock.yaml` through `rules_js`; do not run ad hoc `pnpm install` inside ordinary build/test actions.
- Do not add root `package.json`, pnpm lock/workspace files, TypeScript configs, Vite/Vitest configs, oxfmt/oxlint configs, or Node-version files. The SPA is one local pnpm package; it does not require a repository-wide pnpm workspace.
- Root Bazel module/toolchain registration and aggregate targets may reference frontend Bazel labels and the frontend lockfile. Keep JavaScript dependency declarations, scripts, and tool-specific settings in the SPA directory.
- Rust compilation uses native Bazel Rust rules. Vite, TypeScript checks, frontend tests, and formatting/lint tools run as declared JavaScript actions with explicit inputs, outputs, and pinned tools.
- Generate frontend contracts from the shared Rust model as an explicit build dependency before frontend compilation. Export JSON Schema from the Rust contracts and derive TypeScript declarations using tools owned by `services/paas-ui/tools/contracts`; do not maintain parallel handwritten API models or Zod schemas. Rust schema export remains in the shared Rust crate.
- Keep generated files in declared Bazel outputs. Builds must not modify source files, rely on undeclared `target/` or `dist/` directories, or require a manually prepared `node_modules` tree.
- Plain Rust development remains available through `cargo build -p control-plane` and `cargo test -p control-plane`; neither builds the frontend or invokes Docker. CI verifies Bazel compilation uses compatible features and contracts.
- The image target has direct artifact dependencies on the Linux backend executable and complete frontend bundle. No Cargo dependency, `build.rs`, or build-time recursive invocation of Cargo is needed to stage those artifacts.
- Stage the executable and SPA into the control-plane runtime image, putting the frontend at `/usr/share/homelab-paas/ui`. Keep the assets as files; do not embed them in the Rust executable.
- Under the nested-workload deployment model, embed that control-plane OCI image into the outer K3s appliance and import it during bootstrap. This still delivers one user-facing Docker image, with no separately installed frontend or backend image.
- Keep the application binary, static bundle, bundled runtime image, and outer appliance on the same release revision. Verify `index.html` and referenced assets exist in the runtime image.
- Use `rules_oci` image/layer targets for assembly. Build OCI artifacts without a Docker daemon; image loading, pushing, and privileged runtime tests are explicit actions separate from compilation and assembly.
- Build target executables for the intended Linux architecture and ABI; never package a developer's macOS executable into the appliance. Keep execution-platform code generators distinct from target-platform application binaries.
- Node.js, pnpm, Rust compilers, Cargo, and Bazel are build/development dependencies. The production control-plane runtime contains the Rust executable, SPA assets, and required runtime libraries/certificates.
- Keep dependency fetching in Bazel's declared dependency mechanisms. Ordinary build/test actions must not fetch packages or depend on production services or credentials.
- Run Docker/K3s acceptance tests explicitly on an isolated Linux runner with local privileged execution. They cannot run as ordinary remote/sandboxed unit tests.

Implemented MVP targets:

```text
bazel build //services/control-plane:control-plane
bazel build //services/paas-ui:bundle
bazel build --config=linux-arm64 //deploy/appliance:image
bazel test //...
bazel build //:check                 # formatting checks, lint, type checks, contracts
bazel run //services/paas-ui:dev
```

Use `linux-amd64` for x86-64 image builds. `bazel run --config=linux-arm64 //deploy/appliance:load` explicitly loads the control-plane workload image into Docker. The current image target produces only that inner workload, not the future outer K3s appliance. It uses a static musl executable and scratch base, so there is no mutable base image or base digest to resolve. It contains no TLS clients yet; add a pinned certificate bundle when outbound HTTPS is introduced.

The MVP pins Rust 1.90.0 (edition 2024), Bazel 8.4.2, Node 22.14.0, pnpm 10.11.0, and the Bazel rule/toolchain versions in `MODULE.bazel`. Zig supplies Linux cross-linking from macOS and Linux. Cargo and pnpm lockfiles remain the dependency source of truth. Shared-contract generation and privileged production-appliance acceptance targets are deferred until their implementation exists. Formatting uses `cargo fmt --all` and frontend-local `pnpm format`; `//:check` checks Rust formatting/Clippy and frontend formatting/lint/types, while `bazel test //...` runs routing and frontend tests.

### Local development with Docker and k3d

`scripts/bootstrap.sh` uses the root Brewfile to install macOS development tools and installs pinned Rust/frontend dependencies. `scripts/build-image.py` builds the Linux OCI image through Bazel without a daemon. `scripts/dev-deploy.py` creates or reuses the dedicated single-server `homelab-paas-dev` k3d cluster, builds/loads/imports the control-plane image, applies the local Kubernetes manifests, and waits for readiness. Docker must be running for deployment. Repeat the deployment script during development; it does not recreate the cluster or change the user's default kubeconfig/context. The local K3s version is pinned in that script. Ports are loopback-only. See [README](../README.md) for commands, prerequisites, and teardown.

This development loop does not replace the production systemd/Docker/K3s topology or its privileged acceptance tests. Neither ordinary Bazel checks nor CI unit tests start Docker or k3d.

The acceptance target must be tagged for explicit/local execution so `bazel test //...` does not unexpectedly start privileged infrastructure. A normal build/test command must never push or load an image.

## Toolchain conventions

- Use stable Rust with a pinned toolchain, declared minimum supported Rust version, shared dependency versions, and workspace lint settings. Bazel and Cargo development builds must agree on the Rust edition, features, and dependency lock.

- Pin Bazel and Rust in the root workspace/toolchain configuration. Declare frontend Node.js compatibility and the pnpm version in `services/paas-ui/package.json`, and ensure Bazel's pinned JavaScript toolchain agrees. Do not mix npm/yarn lockfiles or fetch undeclared dependencies inside build actions.

## CI security

- Keep privileged runtime tests isolated from production secrets. Untrusted pull-request code must not execute on a privileged self-hosted runner with sensitive access.

## CI and verification targets

Expose Bazel targets for formatting, formatting checks, Clippy, frontend lint/type checks, Rust/frontend tests, contract/example validation, the backend executable, the frontend bundle, and OCI images. Keep privileged acceptance tests and release publication separate from ordinary build/test targets.

GitHub Actions must use the pinned Bazel version and locked Bzlmod, Cargo, and frontend-local pnpm dependencies; run formatting/lint/type checks and relevant tests through Bazel; validate examples against shared schemas; and build both services plus the appliance. Frontend-specific commands use the SPA package/configuration rather than a root JavaScript project. Use separate jobs for privileged acceptance tests and release publication. Release workflows publish versioned OCI artifacts and record component versions. Never publish credentials in images, build caches, or fixtures.

## Reference documentation

- [Bazel Bzlmod/dependencies](https://bazel.build/external/overview)
- [Bazel Rust rules](https://bazelbuild.github.io/rules_rust/)
- [Cargo dependency import through crate universe](https://bazelbuild.github.io/rules_rust/crate_universe_bzlmod.html)
- [Bazel JavaScript rules](https://github.com/aspect-build/rules_js)
- [Bazel OCI rules](https://github.com/bazel-contrib/rules_oci)
