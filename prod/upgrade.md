# Upgrade the production platform

Copy [upgrade-paas.sh](upgrade-paas.sh) to `~/upgrade-paas.sh` on the production Docker host, then run:

```sh
sudo bash ~/upgrade-paas.sh
```

Requires Bash, Git, Docker with Compose v2, and the standard `mktemp`, `install`, and `rm` utilities. Authenticate to GHCR as the user running the script if the package is private. Run one upgrade at a time.

The script shallow-clones the latest `main` into a private temporary checkout, pins the production Compose template's control-plane image to that checkout's full commit SHA, and validates Compose before stopping anything. It runs `docker compose down` against the installed `/etc/homelab-paas/docker-compose.yaml`, replaces only that file with mode `0600`, then runs `docker compose up -d`. The checkout is removed on exit. Local Compose customizations are replaced; `config.yaml`, `envoy.yaml`, application secrets, and persistent state are retained.

This sequence interrupts ingress while Envoy is stopped. Wait for the latest `main` commit's [CI image publication](../docs/development.md#continuous-integration-and-image-publishing) before upgrading. If its image is unavailable, `up -d` fails after the old platform has stopped. The script exits on failure and does not roll back automatically. Once publication or registry access is fixed, retry:

```sh
sudo docker compose -f /etc/homelab-paas/docker-compose.yaml up -d
```

Verify logs, login, TLS and application routes using the [production checks](README.md#start-and-verify). `up -d` returning successfully does not establish readiness for every application.
