# PaaS observability stack

`paas-metrics.sd.yaml` deploys Grafana with private ingress, plus VictoriaMetrics and VictoriaLogs workers. Grafana queries both stores over the dedicated service network using resource DNS names. No host ports are published. Platform authentication and TLS must be enabled; see [networking](../../docs/networking-and-auth.md).

VictoriaMetrics scrapes all three resources' `/metrics` endpoints every 30 seconds and retains metrics for 30 days. VictoriaLogs retains logs for 14 days. This stack does not collect control-plane, application, Docker, or host telemetry automatically. Additional exporters, instrumentation, and log collectors are separate work; cross-service discovery is currently deferred.

## Host preparation

Run from the repository root on the **Docker host**, before registering the service:

```sh
sudo install -d -m 0755 /etc/homelab-paas/paas-metrics
sudo install -m 0644 services/paas-metrics/grafana-datasources.yaml /etc/homelab-paas/paas-metrics/grafana-datasources.yaml
sudo install -m 0644 services/paas-metrics/prometheus.yaml /etc/homelab-paas/paas-metrics/prometheus.yaml
sudo install -d -o 472 -g 0 -m 0750 /var/homelab-paas/paas-metrics/grafana
```

Grafana runs as UID 472. Its data mount opts out of PaaS's default `1000:1000` ownership preparation; preserve UID 472 ownership when restoring data. Docker/PaaS prepares the other writable data directories. See [volume semantics](../../docs/configuration.md#volumes-and-resource-limits), including SELinux relabeling. All resources use recreate deployment to avoid concurrent access to persistent data.

Create or update the restricted, operator-managed `/etc/homelab-paas/env/paas-metrics.env` file with a strong initial Grafana administrator password:

```dotenv
GF_SECURITY_ADMIN_PASSWORD=replace-with-a-strong-password
```

Use directory mode `0700` and file mode `0600`; the file must be readable by the control plane. The initial Grafana username is `admin`. Grafana stores users, dashboards, settings, and installed plugins in `/var/lib/grafana`; changing this environment secret does not reset an existing administrator password. Grafana's own login remains enabled in addition to platform authentication.

The VictoriaLogs datasource plugin is pinned and installed synchronously before Grafana starts. First startup requires outbound access to Grafana's plugin registry/download endpoints. The persistent Grafana directory retains the installation. Image versions follow the [upstream stack example](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/deployment/docker/compose-vl-single.yml); plugin configuration follows [Grafana plugin settings](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#plugins).

## Register and access

Add `paas-metrics` to the platform configuration's `services` map, using the repository remote, branch, and descriptor path. For the mounted local-development repository:

```yaml
services:
    paas-metrics:
        remote: local
        descriptorPath: /mnt/repo/services/paas-metrics/paas-metrics.sd.yaml
```

Merge this entry into the existing map, retaining other services. Commit the descriptor before reconciliation; local Git sources read committed content. See [Git configuration](../../docs/configuration.md#implemented-deployment-mvp).

Open `https://paas-metrics.{baseDomain}` (also available at `https://grafana.paas-metrics.{baseDomain}`) and sign in. The provisioned VictoriaMetrics datasource is the default; select VictoriaLogs in Explore to query ingested logs. Worker APIs are reachable only on the service network at `http://victoriametrics:8428` and `http://victorialogs:9428`.

The bind sources are Docker host paths, independent of bootstrap state mounts. Docker Desktop users must provision/share these paths on its host; the local bootstrap's `local/var` mapping does not relocate workload data. Removing containers retains data. Configuration files are copied separately from Git: after changing either provisioning file, update its host copy and redeploy the service through the management UI. See [manual redeployment](../../docs/reconciliation-and-deployments.md#manual-redeploy).
