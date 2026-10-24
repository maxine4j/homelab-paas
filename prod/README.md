# Production deployment

This Compose bootstrap starts Envoy and the control plane on one Linux Docker host. The control plane creates workloads through Docker Engine. The platform is under development; check the [implemented runtime limits](../docs/configuration.md#implemented-deployment-mvp) before deploying applications.

## Prepare the host

- Install Docker Engine and the Docker Compose plugin on a `linux/amd64` host, matching the [published images](../docs/development.md#continuous-integration-and-image-publishing). Enable Docker at host boot (on a systemd host: `sudo systemctl enable --now docker`).
- Reserve public TCP ports 80 and 443 for Envoy and allow them through the host firewall. Do not expose the Docker API, control-plane port 8080, or Envoy admin port 9901. The Compose file publishes only Envoy ingress.
- Point the base domain and its wildcard at the host, for example `apps.example.com` and `*.apps.example.com`. Configure IPv6 records only if the host accepts IPv6 traffic. DigitalOcean must manage the DNS zone; provide an API token that can discover the zone and create/delete DNS challenge records. The host needs outbound access to Docker registries, Git, GitHub OAuth, DigitalOcean and Let's Encrypt. See [networking and TLS](../docs/networking-and-auth.md).
- Create a GitHub OAuth application with callback `https://auth.apps.example.com/auth/callback`, substituting your root/base domain. Have the admin's GitHub username ready for the sign-in allowlist.

Install Git, Bash, Python (`python3`, or `python`), curl, and the standard `install` and `stty` utilities. Run from an interactive terminal on the deployment host:

```sh
curl -fsSL https://raw.githubusercontent.com/maxine4j/homelab-paas/main/prod/install.sh | sudo bash
```

The [installer](install.sh) shallow-clones `main` into a private `/tmp/homelab-paas-{uuid}` checkout and removes it on exit. It asks for the root/base domain, admin's GitHub username, and ACME email, and shows the derived GitHub OAuth callback URL. The username becomes the initial entry in `auth.github.allowedUsers`. It reads the GitHub OAuth client ID, client secret, and DigitalOcean API token with hidden terminal input, generates a fresh JWT signing key with Python's `os.urandom(32)` encoded as URL-safe base64, and fills all platform settings into `config.yaml`. Credentials are never printed or passed as process arguments.

It installs the three templates under `/etc/homelab-paas`, creates `/etc/homelab-paas/env` and `/var/homelab-paas`, and uses directory mode `0700` and file mode `0600`. Existing `/etc/homelab-paas` is refused without overwriting configuration or credentials; existing persistent state is retained. The installer does not install Docker or start containers.

The control-plane image tag is pinned to the full commit SHA of the cloned `main`. Wait for that commit's CI image publication before pulling; if its build fails, choose an existing published full commit SHA or `vX.X.X` release in `/etc/homelab-paas/docker-compose.yaml`. There is no `latest` tag. Authenticate to GHCR on the host if the package is private, using the same user/context as the Compose commands below.

Open `/etc/homelab-paas/config.yaml` with a privileged editor (for example, `sudo nano /etc/homelab-paas/config.yaml`) only to add your service configurations. The installer has already supplied the domain, GitHub allowlist, ACME email, all platform credentials, and session signing key. All platform credentials live in this file; this bootstrap requires no `.env` file or credential environment overrides.

Add your services under `services`, replacing the empty mapping with service entries like the commented example. Use accessible HTTPS repositories and committed descriptors; authenticated Git remotes are deferred. See the authoritative [configuration contract](../docs/configuration.md). Keep `metadata.clusterId: prod` matched to both Compose cluster labels, and keep service names `paas` and `envoy` for internal discovery.

Provision application bind-mount sources on the Docker host before adding descriptors. For secret references, install `/etc/homelab-paas/env/{serviceId}.env` with mode `0600`; these are application secret files, separate from Compose interpolation. See [secrets](../docs/configuration.md#environment-variables-and-secrets) and [volumes](../docs/configuration.md#volumes-and-resource-limits).

The configuration directory is mounted read-only into both bootstrap containers. The control plane writes persistent state and TLS private material under `/var/homelab-paas`; Envoy mounts that directory read-only and runs as root to read restricted files. Keep these directories restricted to host administrators. Docker socket access grants the control plane host-level control.

## Start and verify

Run on the deployment host:

```sh
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml config --quiet
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml pull
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml up -d
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml ps
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml logs --tail=100 paas envoy
curl --fail --head http://apps.example.com/
```

Substitute your domain. HTTP should redirect to HTTPS. Open `https://apps.example.com/` to verify the [management UI](../docs/management-ui.md), GitHub login and certificate; then verify each configured application's URL. Initial TLS provisioning requires working DNS and API credentials. A healthy control-plane probe alone does not confirm certificate issuance, accepted Envoy routes, or successful application deployments; check logs and the UI for failures.

Both bootstrap containers use `restart: unless-stopped`. With Docker enabled at boot, they restart after a host reboot unless explicitly stopped. Compose is not a boot service; its dependency health ordering applies to `compose up`, while Docker restart policies handle daemon restarts. After a reboot, verify bootstrap health and application routes again.

## Configuration and updates

After editing platform configuration, restart the control plane:

```sh
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml restart paas
```

For an image update, edit the pinned image tag, then run `pull` and `up -d` again. Compose replaces the changed bootstrap containers. Verify logs, login, TLS and routes after updates. Descriptor changes are reconciled from committed Git revisions; referenced application secret changes are reread on polling passes. See [reconciliation](../docs/reconciliation-and-deployments.md).

Retain `/var/homelab-paas`, configuration and secret files, generated credentials, and all application bind-mount data across restarts and updates. Bootstrap container replacement does not remove Docker-managed workloads or service networks. Do not prune platform resources or delete persistent state to repair deployment failures. Backups and disaster recovery remain operator responsibilities outside the current platform scope.
