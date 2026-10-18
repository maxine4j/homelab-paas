# Homelab PaaS

MVP: a TypeScript/Node 24/Koa control plane serves a React/Vite hello-world SPA and an empty `GET /api/health` response (200). The browser checks immediately and every five seconds, with a four-second timeout.

Shared TypeScript contracts supply API error types directly, without code generation. Authentication, reconciliation, controller persistence, management features, and the production outer K3s appliance are not implemented in this branch. Do not expose this development deployment publicly.

## Setup

Use Node 24 (pinned in `.node-version`) and pnpm 10.34.7 (pinned in `package.json`). On macOS, install [Homebrew](https://brew.sh), Xcode Command Line Tools (`xcode-select --install`), then:

```sh
./scripts/bootstrap.sh
```

The Brewfile installs Node 24, pnpm, Python 3.13, Docker Desktop, k3d, and kubectl. Add `$(brew --prefix node@24)/bin` to your shell PATH. On another host with the pinned Node/pnpm available:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

One root pnpm workspace and lockfile own all three packages. TypeScript is pinned to the npm `latest` version resolved during this migration, 7.0.2. Vitest tests runtime packages; Oxc's oxlint and oxfmt lint and format the repository. Use `pnpm format` to apply formatting.

## Development

```sh
pnpm dev
```

This builds shared contracts, then starts the backend and Vite. Open the Vite URL; its API proxy points to `127.0.0.1:8080`. Backend source changes restart its development server. Stop the local k3d deployment before using its HTTP port.

For package-specific work:

```sh
pnpm --filter @homelab-paas/shared-contracts build
pnpm --filter @homelab-paas/paas dev
pnpm --filter @homelab-paas/ui dev
```

Production runs compiled JavaScript with `pnpm --filter @homelab-paas/paas start`. Set `PAAS_UI_DIR` to the absolute `services/paas-ui/dist` directory to serve a local bundle. Its default is `/usr/share/homelab-paas/ui`. `PAAS_LISTEN` defaults to `127.0.0.1:8080`; `LOG_LEVEL` defaults to `info`.

## Linux image

Image packaging is explicit and requires a running Docker/Buildx builder:

```sh
pnpm image
pnpm image --arch amd64
```

The multi-stage Dockerfile builds the locked workspace and native dependencies for the selected Linux architecture, then packages compiled JavaScript, production dependencies, Node 24, and SPA assets. Its Node base is pinned by multiarchitecture digest and it runs as UID/GID 65532. `artifacts/paas-linux-<arch>.oci.tar` is an OCI archive; packaging neither loads nor publishes it.

Packaging creates or reuses the `homelab-paas-build` Buildx container builder and preserves your default builder. Its cache remains available for repeated builds. Validate the packaged backend and SPA assets with:

```sh
python3 deploy/appliance/bundle_test.py artifacts/paas-linux-arm64.oci.tar
```

The image is the inner control-plane workload; the production outer appliance remains future work. Ordinary checks/tests/builds do not start Docker, k3d, or external services.

## Local deployment

Start Docker Desktop and finish its setup. Allow at least 4 CPUs, 6 GiB RAM, and several GiB free disk for image builds and K3s.

For an existing development cluster from before the `paas` rename, remove the old Deployment and Service once to release its NodePort before redeploying:

```sh
kubectl --context k3d-homelab-paas-dev -n homelab-paas delete deployment/control-plane service/control-plane --ignore-not-found
```

```sh
pnpm dev:deploy
```

Open [the local UI](http://127.0.0.1:8080). The script creates the single-server `homelab-paas-dev` k3d cluster once and reuses it, builds/loads/imports a content-tagged image, applies the local manifests, and waits for readiness. No registry is required. Images remain cached; remove unused development images manually.

HTTP binds to `127.0.0.1:8080` and the Kubernetes API to `127.0.0.1:6445`. The script uses an ignored `.dev/kubeconfig` and an explicit context, preserving your default context. Workloads never mount the host Docker socket.

```sh
curl -f http://127.0.0.1:8080/api/health
KUBECONFIG=.dev/kubeconfig kubectl -n homelab-paas logs deployment/paas
# Explicit teardown; deletes the development cluster and its data:
k3d cluster delete homelab-paas-dev
```

See [the platform specification](docs/platform-spec.md), [build guide](docs/build-and-ci.md), and [frontend guide](docs/frontend.md).
