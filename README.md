# homelab-paas

Install on your Linux Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/maxine4j/homelab-paas/main/prod/install.sh | sudo bash
```

The installer asks for your root domain, admin's GitHub username, ACME email, GitHub OAuth credentials, and DigitalOcean token. Credential input is hidden. Then edit `/etc/homelab-paas/config.yaml` only to add your service configurations. Follow [production deployment](prod/README.md) for prerequisites and startup.

A single-host platform for running services with Docker Engine, Envoy, and a TypeScript/Node.js control plane. Service descriptors are managed in Git and reconciled into Docker workloads.

The platform is under development. See the [architecture](docs/architecture.md) for the intended design, the [implemented deployment MVP](docs/configuration.md#implemented-deployment-mvp) for current capabilities, and the [management UI](docs/management-ui.md) for read-only cluster and resource inspection.

## Local development

Use Node.js 24, the pnpm version pinned in `package.json`, and Docker with Compose. On macOS, `./scripts/bootstrap.sh` installs the Homebrew tools and workspace dependencies. Otherwise:

```sh
pnpm install --frozen-lockfile
```

Start Docker, then build the fixture image and start Envoy and the control plane:

```sh
pnpm dev:deploy
curl --fail http://localhost/health
curl --fail http://test-service.localhost/ping
```

The control plane reads the fixture descriptor from the checkout's committed `HEAD`. See [development](docs/development.md) for configuration, reload behaviour, verification, and shutdown details.

For development processes outside Docker, use `pnpm dev`. Run repository checks with:

```sh
pnpm check
pnpm test
pnpm build
```

## Documentation

- [Production deployment](prod/README.md)
- [Architecture](docs/architecture.md)
- [Configuration and service descriptors](docs/configuration.md)
- [Networking and authentication](docs/networking-and-auth.md)
- [Reconciliation and deployments](docs/reconciliation-and-deployments.md)
- [Managed resources](docs/managed-resources.md)
- [Development](docs/development.md)
