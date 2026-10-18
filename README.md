# Homelab PaaS

MVP: an Axum control plane serves a React/Vite hello-world SPA and `GET /api/health` (200). The browser checks immediately and every five seconds, showing `healthcheck: up` or `healthcheck: down`; requests time out after four seconds.

This is a local development milestone. Authentication, reconciliation, shared JSON contracts, and the production outer K3s appliance are not implemented. Do not expose this development deployment publicly.

## First clone (macOS / Homebrew)

Install [Homebrew](https://brew.sh) and Xcode Command Line Tools (`xcode-select --install`), then:

```sh
./scripts/bootstrap.sh
```

The Brewfile installs Bazelisk, Rustup, Node 22, pnpm, Python 3.13, Docker Desktop, k3d, kubectl, and Buildifier. The script installs the pinned Rust toolchain and frontend dependencies. Bazel downloads its pinned compilers and declared dependencies on first build. Homebrew installs host utilities; language and build versions are pinned by the repository.

Start Docker Desktop and finish its first-run setup. Allow at least 4 CPUs, 6 GiB RAM, and several GiB free disk for initial builds and K3s. For language development, put `$(brew --prefix node@22)/bin` and `$(brew --prefix rustup)/bin` on your shell PATH (Rustup is keg-only). The bootstrap script sets these paths for its own commands.

## Build the Linux image

```sh
./scripts/build-image.py
# Optional cross-build:
./scripts/build-image.py --arch amd64
```

This runs the Bazel OCI image target without requiring Docker. It cross-compiles a static Linux musl executable and packages it with the SPA in a scratch image running as UID 65532. No Dockerfile or second image builder is involved. Build outputs stay in Bazel's output tree. The OCI layout is at `bazel-bin/deploy/appliance/image`; its `index.json` records the manifest digest.

## Deploy and repeat

```sh
./scripts/dev-deploy.py
```

Open [the local UI](http://127.0.0.1:8080). The script creates `homelab-paas-dev` once, then reuses it on subsequent runs. Every run builds incrementally, loads the image into Docker, imports a content-tagged image into K3s, applies the local manifests, and waits for the rollout. Unchanged image content does not trigger a rollout. Build and deploy use the Docker daemon's architecture. No registry is required.

Local HTTP binds to `127.0.0.1:8080`; the Kubernetes API binds to `127.0.0.1:6445`. These ports must be free. The script uses an ignored `.dev/kubeconfig` and explicit context; it does not switch your default Kubernetes context. It never mounts the Docker socket into the control plane.

```sh
curl -f http://127.0.0.1:8080/api/health
KUBECONFIG=.dev/kubeconfig kubectl -n homelab-paas logs deployment/control-plane
# Explicit teardown; deletes this development cluster and its data:
k3d cluster delete homelab-paas-dev
```

The deployment script intentionally retains Docker images for cache reuse. Remove unused development images manually when needed. Kubernetes retains two previous deployment revisions.

## Build and checks

```sh
bazel build //services/control-plane:control-plane //services/paas-ui:bundle
bazel build //:check
bazel test //...
```

Image targets require a Linux configuration:

```sh
bazel build --config=linux-arm64 //deploy/appliance:image
# Explicitly load the image into Docker:
bazel run --config=linux-arm64 //deploy/appliance:load
```

Use `linux-amd64` on x86-64. Rust toolchain 1.90.0 / edition 2024, Bazel 8.4.2, Node 22.14.0, and pnpm 10.11.0 are pinned. Dependency versions resolve from committed Cargo, pnpm, and Bzlmod locks. Linux image linking uses the pinned Zig/musl Bazel toolchain; host builds use the host C linker.

## Language development

For fast UI iteration, use two terminals:

```sh
cargo run -p control-plane
```

```sh
bazel run //services/paas-ui:dev
```

Open the Vite URL printed in the terminal. Vite proxies `/api` to `127.0.0.1:8080`. Backend-only Cargo builds never require the SPA. To serve a locally built bundle through Cargo, set `PAAS_UI_DIR` to the absolute `bazel-bin/services/paas-ui/dist` path. `PAAS_LISTEN` changes the backend listener; its default is loopback port 8080. Stop a deployed k3d cluster before using that same port for Cargo.

Frontend-local commands also work after bootstrap: `cd services/paas-ui && pnpm dev`. Use `cargo fmt --all` and frontend-local `pnpm format` to format source. Bazel owns repository checks, tests, builds, and packaging.

See [the platform specification](docs/platform-spec.md), [build guide](docs/build-and-ci.md), and [frontend guide](docs/frontend.md).
