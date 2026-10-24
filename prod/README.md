# Production deployment

Production deployment targets **Fedora CoreOS with Podman** on a single `linux/amd64` host. Two rootful Podman Quadlets run the control plane and Envoy as systemd services. The control plane manages application workloads through Podman's Docker-compatible API. Docker Engine and Docker Compose are not required.

The platform is under development; check the [implemented runtime limits](../docs/configuration.md#implemented-deployment-mvp) before deploying applications. The CoreOS deployment still needs an end-to-end runtime verification.

## Prepare the host

- Use Fedora CoreOS with systemd and Podman 5 or newer, including Quadlet support. Check the installed version with `podman --version`.
- Reserve public TCP ports 80 and 443 for Envoy and allow them through the host firewall. Do not expose the Podman API, control-plane port 8080, or Envoy admin port 9901.
- Point the base domain and its wildcard at the host, for example `apps.example.com` and `*.apps.example.com`. Configure IPv6 records only if the host accepts IPv6 traffic. DigitalOcean must manage the DNS zone; provide an API token that can discover the zone and create/delete DNS challenge records. The host needs outbound access to container registries, Git, GitHub OAuth, DigitalOcean and Let's Encrypt. See [networking and TLS](../docs/networking-and-auth.md).
- Create a GitHub OAuth application with callback `https://auth.apps.example.com/auth/callback`, substituting your base domain. Have the admin's GitHub username ready for the sign-in allowlist.

## Install and configure

Ensure Podman, systemctl, Git, Bash, curl, and the standard `install`, `stty`, `od`, `tr`, and `sed` utilities are available. The installer also requires CoreOS's Quadlet generator at `/usr/lib/systemd/system-generators/podman-system-generator`. Run from an interactive terminal on the CoreOS host:

```sh
curl -fsSL https://raw.githubusercontent.com/maxine4j/homelab-paas/refs/heads/main/prod/install.sh | sudo bash
```

The [installer](install.sh) shallow-clones `main` into a private `/tmp/homelab-paas-{uuid}` checkout and removes it on exit. It asks for the base domain, admin's GitHub username, and ACME email, and shows the derived GitHub OAuth callback URL. It reads the GitHub OAuth client ID, client secret, and DigitalOcean API token with hidden terminal input, generates a fresh 256-bit JWT signing key, and fills the settings into `config.yaml`. Credentials are never printed or passed as process arguments. No Python runtime is required.

The installer validates both Quadlets with the host's Podman generator before installing configuration. It installs `config.yaml` and `envoy.yaml` under `/etc/homelab-paas`, creates `/etc/homelab-paas/env` and `/var/homelab-paas`, and installs these Quadlet sources:

| Installed source                                  | Generated systemd service |
| ------------------------------------------------- | ------------------------- |
| `/etc/containers/systemd/homelab-paas.container`  | `homelab-paas.service`    |
| `/etc/containers/systemd/homelab-envoy.container` | `homelab-envoy.service`   |

It then runs `systemctl daemon-reload` and verifies both services are loaded. A missing or invalid generated service fails the installation instead of reporting success. Configuration and state directories use mode `0700`; installed files use `0600`. Existing configuration or either Quadlet is refused without overwriting it; persistent state is retained. The installer does not install Podman or start containers.

Edit the `.container` sources to change container settings; use the generated `.service` names with `systemctl`. Do not rename the sources to `.service` or edit the generated units. Templates are [homelab-paas.container](etc/containers/systemd/homelab-paas.container) and [homelab-envoy.container](etc/containers/systemd/homelab-envoy.container).

The control-plane image is pinned to the cloned `main` commit's full SHA. Wait for that commit's [CI image publication](../docs/development.md#continuous-integration-and-image-publishing) before starting. If its build fails, select an existing published full commit SHA or `vX.X.X` release in `/etc/containers/systemd/homelab-paas.container`. There is no `latest` tag. For private GHCR packages, authenticate with `sudo podman login ghcr.io --authfile /etc/homelab-paas/registry-auth.json`, keep that file mode `0600`, and add `AuthFile=/etc/homelab-paas/registry-auth.json` under `[Container]` in the control-plane Quadlet.

Edit `/etc/homelab-paas/config.yaml` to add your services under `services`, replacing the empty mapping with entries like the commented example. The installer supplies all platform settings and credentials. Use accessible HTTPS repositories and committed descriptors; authenticated Git remotes are deferred. See the [configuration contract](../docs/configuration.md). Keep `metadata.clusterId: prod` matched to both Quadlet cluster labels.

Provision application bind-mount sources on the host before adding descriptors. Install application secrets at `/etc/homelab-paas/env/{serviceId}.env` with mode `0600`. On SELinux hosts, application bind-mount sources also need labels permitting container access. See [secrets and volumes](../docs/configuration.md#environment-variables-and-secrets).

The control plane mounts `/run/podman/podman.sock` at `/var/run/docker.sock` and disables SELinux container labeling to access the API, as required by [Podman's socket documentation](https://docs.podman.io/en/stable/markdown/podman-system-service.1.html). This grants host-level control. Envoy uses shared SELinux labels (`:z`) on configuration and state mounts and runs as root to read restricted files. Configuration is read-only in both containers; only the control plane writes persistent state and TLS material.

## Start and verify

Run on the CoreOS host. Use `sudo` for Podman and systemd commands: these Quadlets run as root and use the system Podman socket.

```sh
sudo systemctl enable --now podman.socket
sudo systemctl start homelab-paas.service homelab-envoy.service
sudo systemctl status homelab-paas.service homelab-envoy.service
sudo podman ps
sudo journalctl -u homelab-paas.service -u homelab-envoy.service -n 100
curl --fail --head http://apps.example.com/
```

Substitute your domain. HTTP should redirect to HTTPS. Open `https://apps.example.com/` to verify the [management UI](../docs/management-ui.md), GitHub login and certificate; then verify each application's URL. Initial TLS provisioning requires working DNS and API credentials. A healthy control-plane probe alone does not confirm certificate issuance, accepted Envoy routes, or successful application deployments.

If a service is missing, inspect the source paths and generator errors before attempting to start it:

```sh
sudo ls -l /etc/containers/systemd/homelab-paas.container /etc/containers/systemd/homelab-envoy.container
sudo /usr/lib/systemd/system-generators/podman-system-generator --dryrun
```

Resolve the reported error in the `.container` source, then run `sudo systemctl daemon-reload` and start the services again.

The Quadlets' `WantedBy=multi-user.target` starts both services at boot; generated services do not need `systemctl enable`. Systemd restarts failed containers. Envoy starts after the control plane passes its health check. See [Quadlet documentation](https://docs.podman.io/en/stable/markdown/podman-systemd.unit.5.html).

## Configuration and updates

After editing platform configuration:

```sh
sudo systemctl restart homelab-paas.service
```

For an image update, edit `Image=` in `/etc/containers/systemd/homelab-paas.container`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl restart homelab-paas.service
```

Restart `homelab-envoy.service` after changing its image or bootstrap configuration. Verify logs, login, TLS and application routes after updates and host reboots. Descriptor changes are reconciled from Git; application secret changes are reread on polling passes. See [reconciliation](../docs/reconciliation-and-deployments.md).

Retain `/var/homelab-paas`, configuration, credentials, and application bind-mount data across restarts and updates. Do not prune platform resources or delete persistent state to repair deployment failures. Backups and disaster recovery remain operator responsibilities outside the current platform scope.
