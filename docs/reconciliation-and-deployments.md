# Reconciliation and deployments

## Implemented deployment MVP

The runtime checks configured services at startup and periodically, serializes reconciliation, validates the entire descriptor, and reconciles one web container per service. Private ingress requires platform auth/TLS; see [configuration](configuration.md#implemented-deployment-mvp). Unchanged resource specifications keep their containers even if the repository commit changes. Docker labels record cluster, service, resource, source revision, and specification identities. Each poll inspects actual Docker state and recovers stopped or missing containers. Git and descriptor failures leave the working deployment and routes intact. Failures retry with exponential backoff bounded by the configured maximum; another service can still reconcile.

New workload containers are named `paas-{clusterId}-{serviceId}-{resourceId}-{specPrefix}`, where `specPrefix` is the first 12 characters of the resource specification hash. These names make `docker ps` readable; Docker labels remain authoritative for programmatic identification and reconciliation.

Recreate resolves the image before withdrawing the route and stopping previous containers. It then creates the replacement, checks readiness, and publishes its endpoint through Envoy filesystem xDS. Images are pulled for creation or a changed reference; development images tagged `:local` use an already loaded Docker image when available. Readiness allows 30 attempts, separated by one second, with a two-second HTTP timeout per probe. Envoy also checks health every five seconds and excludes unhealthy endpoints.

Before invoking either deployment strategy, reconciliation resolves [application secrets](configuration.md#environment-variables-and-secrets) anew, including when Git is unchanged. Missing or invalid secrets preserve the active container and route. Specification hashes include resolved environment values, host mounts and resource limits; changes trigger replacement. Both recreate and surge pass the resolved environment, bind mounts and CPU/memory limits to Docker using the [volume contract](configuration.md#volumes-and-resource-limits). Docker creation or startup failures can leave recreate without its previous container, while surge retains the active revision until replacement readiness and route acceptance.

Mount fingerprints include the shared SELinux label mode. Upgrading from unlabeled binds triggers one replacement for workloads with volumes, using their configured rollout strategy. Workloads without volumes keep their existing specification identity.

Additional state uses simple YAML files under `/var/homelab-paas/_paas/`: `{serviceId}.state.yaml` records desired and active revisions, phase, sanitized failure information, failure count, and the next retry timestamp; `routes.yaml` preserves desired endpoints; `cds.yaml` and `lds.yaml` contain generated Envoy discovery resources. Writes use atomic file replacement. Retry delay doubles from `retryBackoffSeconds` up to `maxRetryBackoffSeconds` and survives restart; successful reconciliation clears the failure count and retry timestamp. Retries run on the first polling pass at or after that timestamp. A deploying checkpoint precedes resource reconciliation; interrupted work is observed again from Docker on the next eligible pass. On restart, persisted routes are restored before deployment work. Unchanged workloads have network attachments repaired and readiness checked before their endpoints are republished, including after uncertain route publication. No database is used. Git fetch repositories live in `_paas/git/`.

Docker event subscriptions, configuration reload, service removal, advanced resources, and multiple replicas are deferred. The sections below describe the complete intended lifecycle. See [configuration](configuration.md#implemented-deployment-mvp) for the accepted MVP contract.

Persistence adapters retain existing filenames and YAML shapes, including `{serviceId}.state.yaml`, `routes.yaml` and certificate metadata; ACME account material remains PEM. Domain stores validate decoded values and sanitize failures over injected generic key-value stores. Missing files are absent state; unreadable, malformed, warning-producing or schema-invalid files fail instead of silently becoming empty state. Legacy routes without an explicit `public` field still require the [documented repair](development.md#local-startup-troubleshooting). In-memory and persistent adapters enforce the same domain validation.

## Deployments

Web and worker resources support:

```yaml
rolloutStrategy: recreate
```

`recreate` is the default.

| Strategy   | Behaviour                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `recreate` | Stop existing containers before starting replacements. Downtime is expected.                              |
| `surge`    | Start replacements alongside existing containers, establish readiness, then retire the previous revision. |

PostgreSQL and RabbitMQ always use recreate deployment.

Surge requires sufficient spare capacity and an application that tolerates overlapping instances. For workers, this includes tolerating concurrent execution across revisions.

`SurgeDeploymentStrategy` implements one web replacement and is registered alongside recreate at startup. It uses a unique instance suffix on the container name so even identical resource specifications can overlap; identity labels remain authoritative. The strategy sleeps one second between unsuccessful readiness checks while keeping the previous containers active. Startup or readiness failures remove only the replacement. An uncertain route-publication outcome retains both revisions. After the [networking service](networking-and-auth.md#networking) confirms route acceptance, the strategy gracefully stops the previous containers with the full termination timeout and removes them. There is no separate drain delay or active-request inspection. Retirement failures are reported without removing the newly routed replacement. Recreate also retains its ready replacement after uncertain publication and aborts replacement creation if retiring existing containers fails.

### Web rollout sequence

For a surge deployment, the platform:

1. Pulls the required image.
2. Starts replacement containers.
3. Waits for successful readiness checks.
4. Updates Envoy and confirms configuration acceptance.
5. Stops assigning new requests to the previous revision.
6. Gracefully stops the previous containers within the termination timeout, allowing applications to finish existing requests.
7. Removes the previous containers.

If replacement readiness fails, the previous revision remains active.

For recreate deployments, the previous containers are stopped first. A failed replacement is reported and retried; uninterrupted availability is not guaranteed.

### Replicas and load balancing

Web and worker resources may specify `replicas`, defaulting to `1`.

Envoy distributes web traffic across ready replicas. Worker replicas run independently and require application-level coordination where necessary.

A stable service URL remains unchanged as containers are replaced.

## Health checks and termination

Web resources accept:

```yaml
healthcheckUrl: /healthcheck
```

This defaults to `/healthcheck`, relative to the configured application port. HTTP `200–299` indicates readiness.

Health-check timing, startup allowance, and failure thresholds are managed by the platform.

Only ready web containers receive Envoy traffic.

Workers have no configurable readiness check in v1. A running worker container establishes process startup, not application readiness. PostgreSQL and RabbitMQ use platform-managed health checks.

Resources may configure graceful termination:

```yaml
termination:
    timeoutSeconds: 60
```

When omitted, the platform uses its default timeout. Containers receive a graceful stop signal, followed by forced termination if the timeout expires. Applications are responsible for finishing existing requests during graceful shutdown.

The platform does not guarantee uninterrupted long-lived streams or connections during deployment.

## Git reconciliation

Each configured repository is checked every configured polling interval.

The platform fetches the configured branch and reads the descriptor from a specific commit. The entire descriptor is validated before changes are applied.

The reconciler must:

- Run at startup, on polling intervals, and after relevant Docker lifecycle events.
- Compare desired configuration with actual managed resources.
- Recover stopped or missing containers.
- Serialize deployments within each service.
- Label Docker objects with service, resource, and revision identities.
- Persist deployment state so interrupted operations can resume safely.
- Retry failed operations with bounded backoff.
- Expose desired revision, active revision, deployment phase, and actionable errors.

Git failures and invalid descriptors preserve the last working deployment.

`ReconcilerService` serializes complete passes across the configured services. For each service it fetches the descriptor through `GitService.fetchFile`, validates the entire descriptor, persists a deploying checkpoint, and invokes the web resource reconciler even when the Git revision is unchanged. Failures are reported with fixed, actionable messages without raw exception content, and another service can still reconcile. State-store failures prevent that service's deployment and are reported independently. `ReconcilerTask` delegates each periodic invocation to this service; the runner waits for completion before scheduling another pass and shutdown waits for in-flight reconciliation.

`GitClient` owns bare-repository initialization, shallow branch fetches, local repository discovery, commit resolution, and committed-file reads. It translates infrastructure failures into sanitized `GitClientError` values. Its injected `NodeGitTransport` owns filesystem calls and noninteractive Git subprocesses, bounded by the configured operation timeout and a 1 MiB output limit. `GitService.fetchFile` owns service-scoped cache directories and the remote/local workflows, using the branch defaults defined in [configuration](configuration.md#implemented-deployment-mvp). It returns only the revision and content; invalid service identities or file paths reject with `GitServiceError`. Callers must serialize reads for each service because remote fetches share its repository's `FETCH_HEAD`.

### Container updates and images

Existing containers should be updated in place where Docker supports the change safely. Changes to images, environment variables, commands, or mounts generally require replacement.

Images are pulled when first creating a resource or deploying a changed image reference. Container creation uses the resolved local image identity.

Periodic detection of changed content behind an unchanged image tag is not required. Image tagging policy belongs to each service.

### Removal

Removing a resource stops and removes its containers. Removing a service stops and removes all its resource containers.

Persistent data and generated credentials are retained.

Reverting the Git change recreates the resource using retained storage and credentials. Compatibility between retained data and the restored image remains the operator’s responsibility.

See [configuration](configuration.md) for descriptor formats and secret resolution, [networking and authentication](networking-and-auth.md) for Envoy boundaries, and [managed resources](managed-resources.md) for retained data and credential rules.
