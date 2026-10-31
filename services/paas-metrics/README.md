# PaaS observability stack

`paas-metrics.sd.yaml` deploys Grafana with private ingress, plus VictoriaMetrics, VictoriaLogs, and Telegraf workers. Grafana queries both stores over the dedicated service network using resource DNS names. No host ports are published. Platform authentication and TLS must be enabled; see [networking](../../docs/networking-and-auth.md).

VictoriaMetrics scrapes Grafana and both stores' `/metrics` endpoints every 30 seconds and retains metrics for 30 days. VictoriaLogs retains logs for 14 days. Telegraf collects Docker container resource metrics and stdout/stderr logs automatically; see [collection](#container-collection-and-resource-budget).

## Fresh-host deployment

Register the service on a configured PaaS host. No configuration files, credentials, plugins, or data directories need manual preparation. The custom Grafana, VictoriaMetrics, and Telegraf images include their configuration; Grafana includes the pinned VictoriaLogs datasource plugin outside its persistent data mount. Docker/PaaS creates persistent data directories automatically.

Grafana runs as UID 472. Its data mount declares `ownership: { uid: 472, gid: 0 }`; PaaS prepares ownership before starting Grafana. Telegraf's state directory retains root ownership; other writable data directories use default ownership. See [volume semantics](../../docs/configuration.md#volumes-and-resource-limits), including SELinux relabeling. All resources use recreate deployment to avoid concurrent access to persistent data.

Upgrade the control plane to a version supporting explicit volume ownership before deploying this descriptor. Ownership preparation changes only the mount root; existing descendant permissions and ownership are preserved. When restoring data, preserve Grafana's UID 472 ownership and writable permissions for its files and subdirectories.

Grafana uses anonymous access with the `Admin` organization role behind private PaaS ingress. After platform authentication, users can manage dashboards and organization settings without a second login. Grafana's login form and basic authentication are disabled; no Grafana password secret file is required. Anonymous access does not impersonate the named `admin` account or grant Grafana server-administrator privileges. See [Grafana anonymous access](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/anonymous-auth/).

Grafana stores users, dashboards, settings, and installed plugins in `/var/lib/grafana`. Existing accounts and data are retained. An existing `GF_SECURITY_ADMIN_PASSWORD` entry in the service secret file is no longer injected and may be removed.

The Docker host must be able to pull the published GHCR images. CI must publish them before first deployment. Make the three new GHCR packages public after their first publication for credential-free pulls from fresh hosts; this is a one-time registry setting, not host configuration. The descriptor uses `latest` from `main`; matching full-commit and release tags allow pinned deployments. See [image publishing](../../docs/development.md#continuous-integration-and-image-publishing). Grafana does not download plugins at startup, report analytics, or check for updates.

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

Persistent data paths refer to the Docker host, independently of bootstrap mounts. Docker Desktop's `local/var` mapping does not relocate workload data. Removing containers retains data. Obsolete provisioning-file directories under `/etc/homelab-paas/paas-metrics/` are no longer mounted and need not be repaired. Configuration/plugin changes require rebuilding and publishing the corresponding image, then [manually redeploying](../../docs/reconciliation-and-deployments.md#manual-redeploy) or changing the pinned image tag. A changed `latest` alone does not replace a running workload. No host configuration copies or startup plugin downloads are required.

## Container collection and resource budget

The collector uses upstream Telegraf's [supported custom build](https://github.com/influxdata/telegraf/blob/v1.39.3/docs/CUSTOMIZATION.md) to compile only the two Docker inputs and the three required outputs. This avoids loading the stock image's hundreds of unrelated plugins. The pinned source archive has a build-time SHA-256 check; no compiler or build dependencies ship in the runtime image.

Telegraf discovers **all running containers on the same Docker Engine**, including bootstrap containers, this stack, and workloads outside PaaS. Through `/var/run/docker.sock`, every 30 seconds it discovers containers and collects CPU, memory, network, block I/O, and state metrics. It follows stdout/stderr logs and sends batches every five seconds. Collection needs no connectivity to other service networks. Container names, images, and selected `homelab-paas.*` labels identify telemetry; arbitrary container labels and environment variables are not copied.

Metrics use VictoriaMetrics' InfluxDB ingestion API and remain queryable through the provisioned Prometheus datasource. For example, `docker_container_mem_usage` shows container memory usage. Logs use VictoriaLogs' Loki ingestion API; select VictoriaLogs in Grafana Explore and query `container_name:my-container`. Log records contain the original `message` and container identity in logfmt format.

Docker must expose logs through its logs API; Telegraf supports the `local`, `json-file`, and `journald` logging drivers. Files written only inside containers are not collected. Application metrics need instrumentation/exporters; Docker stats cannot supply them. Short-lived containers that stop between discovery passes can be missed. Host OS metrics and automatic application endpoint scraping across service networks are outside this stack's scope.

The trusted collector runs as root to access the host socket, without privileged mode or published ports. The read-only socket bind retains host ownership but **does not restrict Docker API operations**; treat collector images and configuration as trusted host administration code. Grafana's anonymous organization Admin access assumes authenticated PaaS ingress; do not expose it directly.

Telegraf is limited to 0.1 CPU and 128 MiB RAM as a starting homelab budget, not a guaranteed requirement. It gathers aggregate rather than per-device metrics and bounds each output buffer to 1,000 records, in batches of 100. When storage is unavailable, retries consume that bounded buffer; overflow drops the oldest records. Buffers are in memory and pending records can be lost on restart. Persisted Docker log positions support resumption after graceful restarts, but this is not an exactly-once or lossless log archive. Tune limits/buffers for sustained traffic; check `docker stats` and collector logs for pressure or dropped records.

Run `sh scripts/test-metrics-images.sh` from the repository root to build images and verify provisioning, cross-network discovery, actual metrics/log ingestion, and collector restart in a disposable Docker Engine. The test requires permission to start a privileged test runner; the deployed collector itself is not privileged. Its CPU/memory sample describes that small fixture, not a production benchmark.
