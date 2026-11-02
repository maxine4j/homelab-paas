# Reconciliation and deployments

Remote descriptor and commit-metadata fetches support optional per-service [Git credentials](configuration.md#private-git-repositories), including live credential changes through configuration reloads.

## Static publication

Static reconcilers export the selected directory from the descriptor's exact Git commit through the shared Git service. They stage regular files in a private sibling directory, then replace `/var/homelab-paas/{serviceId}/static/{resourceId}/` as a complete bundle before publishing its Envoy route. Publication removes stale files, including files absent from the next commit; it never resets or cleans the user's working checkout. Staging or export failure retains the previous bundle and route. Replacement and metadata failures are retryable through the normal reconciliation checkpoint and backoff. Publication is per resource, not an atomic service-wide update.

Published identity and file digests are persisted beside each resource directory and cannot be served by that resource. Reads serialize with publication, never cache old file bytes, and refuse symlinks. Each inspection checks the committed revision, configured path and file contents, including unexpected files. The safety audit queues reconciliation for missing, altered or extra files and incorrect static route policies; reconciliation recreates the clean snapshot. Unchanged snapshots retain their files while routes are revalidated. Across revisions, publication reuses existing files only after a full scan matches the freshly exported bundle's exact file paths and digests, then atomically refreshes the identity manifest. This preserves static files for primary-only descriptor changes while repairing tampering and extra files. Scan or manifest-refresh failures preserve the previous usable content and remain retryable. Forced redeploy bypasses reuse and republishes static bundles as well as replacing workloads. Static-only audits do not require workload networks or containers.

Static health is Healthy for a complete matching snapshot, Missing when absent, Degraded when changed, and Unknown when inspection fails. Sync compares snapshot identity and contents with desired Git inputs. Container inspection does not override static health. Static serving and [ingress](networking-and-auth.md#external-ingress-and-authentication) resume from persisted files and routes on restart. Removal remains under the existing deferred removal contract; persistent data outside the selected static publication directory is preserved.

## Shared Git cache

Reconciliation and management inspection share one Git service with three tiers: an in-memory map, committed objects in local bare repositories, and the configured remote. Warm descriptor and commit-metadata reads use memory without Git commands or network access. A descriptor memory miss awaits a committed disk read and schedules a background refresh; when no disk descriptor exists it awaits remote population and fails explicitly if that fails. Local source mode discovers committed ref changes on the same configurable Git refresh interval, without fetching or reading working-tree contents.

Repositories live at `/var/homelab-paas/_paas/git/{repositoryHash}/repo.git/`. `repositoryHash` is SHA-256 over the remote and credential identity; service IDs, branches and descriptor paths do not select separate repositories. Services using the same remote and credentials share immutable Git objects. Different credentials select separate repositories, including separate SSH `known_hosts` inside each bare repository. Credentials are never stored in repository URLs or plaintext cache metadata. The [six-hour cleanup](#docker-disk-cleanup) retains each shared repository while any configured remote source uses it.

Memory entries and durable descriptor refs remain keyed by the remote, effective branch, descriptor path and credential identity. Each source publishes its last successfully read descriptor commit to `refs/paas/descriptors/{sourceHash}`; a failed fetch or committed-file read leaves that ref and the last good memory entry intact. Source changes discard superseded service memory entries and select another descriptor ref, preventing old source data from being served after reload or restart. Exact-commit metadata fetches preserve `FETCH_HEAD`. Git operations serialize per shared repository, concurrent refresh requests for one service source deduplicate, and distinct repositories fetch concurrently. Failed descriptor population and missing commit metadata are remembered until the next applicable refresh, preventing management snapshot reads from repeatedly hitting a failing remote. Metadata failure never hides deployment status.

Remote refresh runs at startup and every `git.pollIntervalSeconds` (300 by default). Configured sources refresh with per-service failure isolation; operations sharing a repository serialize. After fetches settle, `GitRefreshService` refreshes desired inputs only for successful sources and queues services whose desired inputs changed. Unchanged successful fetches do not reconcile workloads. Fetch success does not guarantee successful deployment: descriptor validation, deployment and existing retry backoff still apply. A refresh failure retains last-known-good data and cannot stop another repository from refreshing. Health follows the independent [resource-health cadence](#resource-health).

## Targeted scheduling and desired inputs

`ReconciliationScheduler` coalesces hints in a per-service queue bounded by configured service identities and runs one service at a time. Startup findings, desired-input changes, explicit redeploy, Docker invalidation and audit findings can request work. A hint arriving during a run remains queued for a subsequent fresh Docker observation. Healthy services have no periodic deployment-reconciliation timer. Desired-input notifications are explicitly distinguished from health, checkpoint and UI notifications; observational notifications cannot schedule deployment work.

`DesiredInputs` caches validated descriptors and fully resolved deployment resources in memory. Its internal identity includes source and credential namespace, committed revision/content, effective ingress/auth/TLS policy and resolved declared secrets. Values and identities are never logged or persisted as cache metadata or exposed in status. Targeted observations reuse these inputs. Successful Git refresh, accepted durable config/secret writes and explicit audit refresh re-observe inputs; unchanged resolved inputs do not request reconciliation. Invalid input refresh discards cached success and follows normal reconciliation failure/backoff reporting, preserving active workloads. External secret edits are discovered by the safety audit, scheduled every 15 minutes; a relevant accepted platform reload can also trigger input refresh. See [configuration](configuration.md#environment-variables-and-secrets) for secret edit guarantees.

Startup reconstructs retry deadlines from persisted checkpoints. A single abortable `ISleep` timer wakes only due services. Ordinary hints and input changes retain failure counts and future backoff; only explicit manual redeploy bypasses it. Uncertain checkpoint reads/writes retain a bounded in-memory retry deadline instead of hot-looping or losing recovery. Initialization subscribes to accepted desired writes before API acceptance; the separate execution gate lets event subscription and initial audit precede deployment work. Shutdown unsubscribes, cancels retry timing, discards pending hints and settles active input reads and deployment work.

## Docker events and safety audit

`DockerEventWatcher` connects one Docker Engine stream through the existing Unix-socket transport before initial owned inventory. It consumes container lifecycle/update and network create/destroy/connect/disconnect hints; exec/attach traffic does not request reconciliation. Engine cluster/service labels establish ownership, never human-readable names. Owned control-plane and Envoy peer changes invalidate all configured service networks. Network identities are inspected and retained in a bounded map so disappearance can still select the affected service. Unmappable owned identities, disappeared unknown objects, mapping failures and full bounded queues conservatively request an audit; independently verified unrelated objects are ignored.

Events invalidate observations and coalesce targeted scheduler work; fresh Docker inspection and ownership checks precede repair. Platform-originated events follow the same path and converge through unchanged-operation suppression. Health-status hints supplement HTTP probes and request fresh health/cache observation without requesting replacement. HTTP failure alone cannot trigger replacement.

Stream decoding accepts split UTF-8 and newline-delimited JSON with bounded frames. Invalid payloads fail without retaining raw attributes in errors/logs; safe connection failures retain transport causes. Cancellation closes pending headers and body consumption. Disconnects/errors reconnect using injected abortable delays, exponentially increasing from one to 30 seconds. Every successful reconnection requests a full audit; bounded Docker replay is not relied upon. Stream consumption, bounded identity mapping and coalesced targeted health/cache refresh continue independently of scans and deployment work. Hints arriving during initial inventory, reconnect inventory or reconciliation are retained.

`DriftAudit` runs at startup, on stream reconnection, every 15 minutes and for explicit management Refresh. It serializes service inventories and container inspections rather than issuing an unbounded scan burst. Overlapping requests coalesce by configured identity and retain another scan before callers complete. Each selected service refreshes desired inputs, including declared secrets, then freshly inventories containers, network membership, workload aliases and supported mutable settings. Infrastructure checks independently verify unique labelled peer identities, running state, attachment and the control-plane alias. CPU comparison uses live Engine `HostConfig.NanoCpus`; memory comparison uses `HostConfig.Memory`, including unexpected limits where none are desired. Missing/invalid live fields fail observation rather than trusting specification labels. Other host CPU controls, bind-mounted contents, ownership/remount changes and arbitrary in-container process/data tampering have no new audit guarantee.

Stopped/missing/extra replicas, changed specifications, supported live limits, attachment/alias drift, peer drift and persisted route mismatch enqueue fresh targeted reconciliation using normal rollout strategy, readiness and retained backoff. Worker retention checks the same mutable settings before reusing replicas. Audits do not use HTTP failure to decide replacement. Invalid desired inputs preserve working workloads/routes and follow normal checkpointed failure/retry reporting. Failed observations invalidate earlier healthy results, remain visible in management observations/operator task logs, and do not stop other services being scanned.

Each audit forces Envoy verification from persisted routes, retaining unsupported and removed-service routes. It never publishes partial inventory as complete desired routing or routes to unready candidates. Persisted route mismatch is repaired by targeted reconciliation after fresh readiness; uncertain xDS acceptance remains retryable. Errors retain routes and queued recovery. Shutdown cancels stream/backoff and periodic timers, discards unstarted audit work and settles active scans, observations and deployment work. Watcher/audit executions carry injected task IDs under the [logging contract](development.md#backend-logging).

The audit interval bounds missed-event detection only while Docker and the control plane are available. Scan duration, deployment backlog, retry backoff and readiness may delay repair further. Manual Docker stops remain repairable unless the service is [paused](#manual-pause-and-resume). Independent [health polling](#resource-health), Git refresh, platform reload and certificate renewal retain their schedules.

## Manual pause and resume

The management UI's Pause action persists `paused: true` in the service's `state.yaml`, serialized with reconciliation and deployment actions. It then withdraws every service route, including resource hostnames, primary aliases and static resources, and stops every live service-owned container with a 30-second graceful-stop timeout. Container ownership checks still apply. Stopped containers, service networks, persistent data, generated credentials and published static bundles are retained.

The shared endpoint reader excludes paused services, including immediately after control-plane restart and after interrupted route withdrawal. This applies to Envoy generation, authorization and static serving. Shutdown attempts every container even if route publication or another stop fails. Failed shutdown retains pause intent and records a sanitized error and a bounded retry deadline. Subsequent reconciliation only enforces shutdown; it cannot deploy paused workloads. Docker events and safety audits can stop containers that were externally restarted while paused.

Git refresh, descriptor inspection and desired-input detection continue while paused. A newer commit is displayed as OutOfSync even if workload specifications are unchanged. Service and resource health display Paused independently of sync. Git/configuration/secret changes, retries, restarts and Redeploy never clear pause intent; Redeploy rejects a paused service. Removing and re-adding a configured source does not clear retained pause state.

Only the explicit management Resume action clears pause intent. It first completes any interrupted shutdown, then reconciles the latest committed desired inputs through normal readiness and route publication. A deployment failure after clearing pause uses normal reconciliation retries. Pause and Resume API access and UI presentation are defined in [management UI](management-ui.md#manual-pause-and-resume).

## Implemented deployment MVP

The runtime checks configured services at startup and on targeted invalidation, serializes reconciliation, validates the entire descriptor, and reconciles the [supported web and worker resources](configuration.md#implemented-deployment-mvp). Private ingress requires platform auth/TLS. Unchanged resource specifications keep their containers even if the repository commit changes. Docker labels record cluster, service, resource, source revision, and specification identities. Eligible targeted attempts inspect actual Docker state and recover stopped or missing containers. Git and descriptor failures leave the working deployment and routes intact. Failures retry with exponential backoff bounded by the configured maximum; another service can still reconcile.

New workload containers are named `paas-{clusterId}-{serviceId}-{resourceId}-{specPrefix}`, where `specPrefix` is the first 12 characters of the resource specification hash. These names make `docker ps` readable; Docker labels remain authoritative for programmatic identification and reconciliation.

Valid web and worker deployments whose desired revision differs from the active revision (including initial deployments) retain the `deploying` phase while failed resource operations retry for five minutes. This allows CI to publish images after a commit is detected. The window starts before resource reconciliation, persists as `deploymentStartedAt` across retries and restarts, and resets for a newer desired revision. Existing checkpoints without this timestamp start their window on the next valid deployment attempt. A failed attempt at or after five minutes sets the internal deployment phase to `failed`; retries continue with normal bounded backoff at eligible retry deadlines. Successful reconciliation clears the window and retry state. Git, descriptor, capability, secret and checkpoint failures, and resource failures on an already-current revision, still fail immediately. Failed attempts retain their diagnostics and service events throughout the window.

Worker names append a fresh instance ID to distinguish replicas and overlapping attempts. `WorkerResourceReconciler` observes replica counts, specification labels, container state, connectivity and private HTTP readiness. `WorkerDeploymentService` repairs missing/stopped replicas while retaining healthy containers with the desired specification; specification changes replace the replica set. Recreate resolves the image before retiring predecessors. Surge probes every replacement before retiring predecessors; a failed startup cleans up new candidates and preserves previous workers. Retirement failures retain ready replacements, which the next pass rechecks and reuses. Worker deployment never publishes or withdraws a web route. A mixed service is reconciled resource by resource, with a service-level ready checkpoint only after all resources succeed; it is not an atomic rollout across resources.

Recreate resolves the image before withdrawing the route and stopping previous containers. It then creates the replacement, checks readiness, and publishes its endpoint through Envoy filesystem xDS. Image resolution follows the [image contract](#container-updates-and-images). Readiness allows 30 attempts, separated by one second, with a two-second HTTP timeout per probe. Envoy also checks health every five seconds and excludes unhealthy endpoints.

Before invoking either deployment strategy, reconciliation obtains validated resolved [desired inputs](#targeted-scheduling-and-desired-inputs), including secrets independently of Git revision changes. Missing or invalid secrets preserve the active container and route. Specification hashes include resolved environment values, host mounts and resource limits; changes trigger replacement. Both recreate and surge pass the resolved environment, bind mounts and CPU/memory limits to Docker using the [volume contract](configuration.md#volumes-and-resource-limits). Docker creation or startup failures can leave recreate without its previous container, while surge retains the active revision until replacement readiness and route acceptance.

Mount fingerprints include the shared SELinux label mode. Upgrading from unlabeled binds triggers one replacement for workloads with volumes, using their configured rollout strategy. Workloads without volumes keep their existing specification identity.

Web and worker specifications also include [device mappings and supplementary groups](configuration.md#devices-and-supplementary-groups). Path, permission and group changes replace containers through either strategy; omitted and empty lists retain existing fingerprints. Docker validates host device availability when creating containers.

Additional state uses simple YAML files under `/var/homelab-paas/{serviceId}/`: `state.yaml` records desired and active revisions, phase, sanitized failure information, failure count, and the next retry timestamp; `routes.yaml` preserves that service's desired endpoints. Startup and route publication aggregate all service route files, including unconfigured services awaiting cleanup. A file containing another service's routes, invalid data or an I/O failure fails the read rather than publishing a partial snapshot. Route changes remain globally serialized; each update atomically replaces only the affected service file before generating and confirming the complete Envoy configuration. Generated Envoy discovery resources live in `_paas/envoy/cds.yaml` and `_paas/envoy/lds.yaml`. Writes use atomic file replacement. Retry delay doubles from `retryBackoffSeconds` up to `maxRetryBackoffSeconds` and survives restart; successful reconciliation clears the failure count and retry timestamp. Retries enter the serialized queue at that timestamp, independently of healthy services. New revisions checkpoint deploying before resource reconciliation, and actual same-revision replacements checkpoint deploying at the deployment boundary; interrupted work is observed again from Docker on the next eligible pass. On restart, persisted routes are restored before deployment work. Unchanged workloads have network attachments repaired and readiness checked before their endpoints are republished, including after uncertain route publication. No database is used. Git fetch repositories live in `_paas/git/`.

Resource removal from descriptors, managed resources, egress and multiple web replicas are deferred. Service removal from platform configuration is implemented under [Removal](#removal). Platform configuration supports [periodic reload](configuration.md#platform-configuration-reload). The sections below describe the complete intended lifecycle. See [configuration](configuration.md#implemented-deployment-mvp) for the accepted MVP contract.

Service persistence uses `{serviceId}/{state,events,health,routes}.yaml`; YAML value shapes and certificate metadata are unchanged, and ACME account material remains PEM. Domain stores validate decoded values and sanitize failures over injected generic key-value stores. Missing files are absent state; unreadable, malformed, warning-producing or schema-invalid files fail instead of silently becoming empty state. Routes require an explicit `public` field. In-memory and persistent adapters enforce the same domain validation. There is no filesystem migration or legacy read fallback.

## Resource health

`ResourceHealthService` independently polls web and worker containers at startup and every 30 seconds, using cached committed descriptors and the existing two-second HTTP probe. This platform-owned interval is not configurable. Deployment retry backoff and long-running rollouts do not delay this polling. Each pass then refreshes the shared [management state cache](management-ui.md#state-cache) and publishes replacements through the change bus; the browser does not poll HTTP. Periodic Git refresh and manual Refresh also poll health and refresh that cache after reconciliation, including failed refresh attempts. Periodic and manual health/cache passes serialize. This observation does not restart workloads or change service deployment checkpoints.

Management snapshot observations also record bounded persistent [health timelines](management-ui.md#health-timelines), separately from current probe state and deployment checkpoints. Retention, unknown observation gaps and event-marker presentation are defined by that management contract.

Deployment completion or failure invalidates rollout health and performs a targeted health/cache refresh for the affected service. Observation failures remain visible but cannot turn a successful deployment into a failed rollout or mask its original failure. Lifecycle callers can invalidate a service immediately and request the same targeted observation independently of deployment scheduling. HTTP failures only change health; they do not request automatic replacement. Docker health events supplement these probes and cannot establish HTTP readiness by themselves. Deployment readiness and Envoy's independent health checks retain their existing behavior.

### Shared runtime observations

Health and management receive one injected backend `RuntimeObservations` component. It coalesces service inventory, container inspection and network inspection within per-service generations. Each health pass starts a fresh generation; lifecycle invalidation discards affected reads immediately. Reads expire after 30 seconds, and invalidated in-flight reads re-observe before returning. A slow fresh request crossing expiry can complete without restarting indefinitely. Failures are retained only for that generation, never replaced with an earlier successful observation. Deployment readiness, ownership enforcement and repair use fresh Docker reads directly rather than this observational cache.

Validated immutable container metadata (image identity, labels, environment and mount definitions) is reused by container ID. Running state, network attachments and adapter-exposed mutable limits are refreshed independently on each fresh inspection. The cache bounds service generations to 1024 services and immutable metadata to 2048 containers; state is process-local and never persisted or exposed wholesale. Descriptor commands, environment, mounts and devices are creation/replacement or discovery concerns, not a guarantee to detect changes to bind-mounted contents, host ownership, remounts or arbitrary process state. Volume initialization remains at creation.

Checkpoint and endpoint stores compare validated persisted values before writing and skip unchanged YAML replacements. Successful unchanged reconciliation emits no checkpoint change notifications. Endpoint reads still observe persisted changes; the confirmed Envoy publication and explicit startup/audit repair rules belong to [networking](networking-and-auth.md#networking).

Management snapshots expose independent `sync` and `health` fields on services and resources, using Argo CD's vocabulary without Suspended and adding Paused for [manual pause](#manual-pause-and-resume). Manual pause takes precedence over observed health and adds the documented service revision comparison to sync. Deployment phase remains an internal persisted checkpoint for retries and recovery, separate from both statuses.

Sync is `Synced` when observed containers match the desired specification and replica count, `OutOfSync` when containers are missing, extra or differ, and `Unknown` when the descriptor, Docker observation or required secrets cannot be read, or the resource type is unsupported. Observed resources absent from an available descriptor are OutOfSync. Comparison reuses reconciliation's specification fingerprints, including resolved secrets and effective primary-web policy. Fingerprints and resolved values remain internal. Runtime readiness and container source revisions do not affect sync; unchanged specifications may retain containers from older commits. Sync comparison is read-only.

Service sync is Unknown if any resource comparison is Unknown, otherwise OutOfSync if any resource differs, otherwise Synced. No observations yields Unknown. Desired configuration and desired revision come from the latest valid committed descriptor. The service list retains active revision metadata and reports Unknown statuses when Docker observation fails.

Each resource has one health status:

- `Paused`: its service has durable manual pause intent; see [manual pause and resume](#manual-pause-and-resume).
- `Progressing`: its rollout is in progress, including startup readiness. This takes precedence over missing containers during recreate. It ends on rollout success or failure; other resources retain their own health.
- `Missing`: no containers are observed outside an active rollout.
- `Healthy`: exactly the expected number of replicas are running. When an HTTP check is configured, each must also be attached to the service network with an address and return HTTP `200`.
- `Degraded`: containers exist but readiness fails, the replica count differs from the expected count, a container is stopped, or a configured connectivity or HTTP check fails.
- `Unknown`: health has not been observed for the current container identities and states, inspection fails, or existing containers belong to an unsupported or observed-only resource.

Web checks use the ingress port; worker checks use `healthcheckPort`. HTTP checks run only for an explicitly configured `healthcheckUrl`; see [health checks](#health-checks-and-termination). Health observations live in memory and apply only to the observed container identities and states. Existing containers remain Unknown until first checked after startup, replacement or rollout completion. Stale probes overlapping a rollout cannot restore old health. Inspection failures invalidate previous healthy observations and do not prevent other resources or services from being checked. Observed-only resources and unsupported managed resources cannot report Healthy solely from Docker lifecycle state. Resource inspection delegates observation refinement to `ResourceHealthService`: total disappearance reports Missing, stopped or partially missing containers refine known assessments to Degraded, and extant Unknown resources retain Unknown. An active rollout retains Progressing throughout inspection.

Service health aggregates resource health using Argo CD's worst-state precedence: Unknown, Degraded, Missing, Progressing, Healthy. No observations yields Unknown. A working old deployment can be Healthy and OutOfSync; an applied configuration with failing readiness can be Synced and Degraded. Deployment failure events and retry metadata remain independent of both statuses. See [management UI](management-ui.md) for badges, placement and API representation.

## Service events

`ReconcilerService` appends every reconciliation failure, including Git, descriptor, capability, secret-resolution, web/worker deployment and checkpoint failures, to an injected service-event store. Failures record a timestamp, severity, operation, redacted error message, revision, resource identity when known, retry count and scheduled retry time when available. Each eligible failed retry adds an event; polling during backoff adds none. Initial deployments, changed active revisions and recovery also add events; successful unchanged polling stays silent.

`events.yaml` under `/var/homelab-paas/{serviceId}/` retains the latest 200 events across restarts, using the existing private, atomic YAML persistence. Appends are serialized; reads return newest first. Missing history is empty, while unreadable or invalid history fails explicitly. Failure event summaries show the actual error message after redaction, whitespace normalization and truncation to 4096 characters, with an explicit `[truncated]` marker. Missing or empty error messages and non-Error failures use “Reconciliation failed; inspect error diagnostics”. The operation identifies the failure category without adding generic reconciliation boilerplate to the summary. Readiness timeouts report the last observed condition after 30 checks: container absent, not running, no service-network address, or HTTP health check not passing. Failed HTTP checks identify the configured port and path without asserting an unobserved cause.

Failure events additionally retain redacted diagnostics: error names, messages, nested causes, aggregate failures, stack traces, provider properties (including available Docker method, path, status and failure body), and operation, service, resource, image, revision and deployment configuration context when available. Non-Error rejections are retained. Summaries and diagnostics redact known platform credentials, resolved declared secret values and URL credentials before persistence or live delivery; echoed child-process commands are masked. Diagnostic credential fields, commands and environment collections are masked. Secret-file causes are omitted because their contents have not been resolved for redaction. Traversal is bounded to eight levels, 128 objects, 32 entries per collection and 16384 characters per redacted string. Each diagnostic's JSON-encoded text is bounded to 32 KiB, with explicit `[truncated]` markers. Arbitrary application-generated or transformed secrets cannot be reliably recognized; workloads and infrastructure integrations must keep them out of failures.

Secret failures additionally carry validated structured diagnostics: failure category, missing variable names, container file path, actual host bind path when resolved, and dotenv line when known; see [secret diagnostics](configuration.md#environment-variables-and-secrets). Existing entries without optional diagnostics remain readable; old events are not enriched retroactively. Unredacted diagnostics remain in [operator logs](development.md#backend-logging). History starts when this feature is installed; previous stdout logs are not imported.

Event writes are independent of checkpoint writes, so checkpoint failures can still be recorded when event storage is available. Event persistence failures are logged and do not prevent deployments or other services from reconciling. History cannot be recorded while its storage is unavailable. The [management UI](management-ui.md) exposes events independently of Git and Docker availability.

Live notifications publish safe `deployment.started`, `deployment.succeeded`, reconciliation failure and recovery events independently of durable append success. New revision starts precede readiness waits; retries in the same deployment window do not repeat the start. Actual same-revision replacements caused by resource drift or resolved-secret changes also enter deploying and report progress. Unchanged health checks remain ready. Configuration changes, Git refreshes and reconciliation checkpoints invalidate subscribed management snapshots through an injected platform change bus; subscriber failures are isolated and logged.

## Deployments

The management [manual redeploy API](management-ui.md#manual-redeploy) serializes a forced pass for one configured service with normal reconciliation. After validating the descriptor and resolving all secrets, it bypasses the unchanged-container fast paths for every web and worker resource, including healthy worker replicas. It preserves specification identities and follows configured rollout strategies, readiness, termination, route acceptance and persistent-volume semantics. The explicit attempt bypasses retry backoff; failures checkpoint and report through the normal reconciliation path, and subsequent scheduled attempts recover from observed Docker state. Replacement is resource-by-resource rather than an atomic service transaction. Unsupported managed-resource descriptors still fail capability validation before changes.

Web and worker resources support:

```yaml
rolloutStrategy: recreate
```

`recreate` is the default.

Resources with explicit [host ports](configuration.md#host-ports) require one replica and recreate. Binding changes replace containers; Docker start publishes ports independently of HTTP readiness and Envoy route acceptance. Conflicts with bindings outside the descriptor are reported through Docker startup failures and normal retries.

| Strategy   | Behaviour                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `recreate` | Stop existing containers before starting replacements. Downtime is expected.                              |
| `surge`    | Start replacements alongside existing containers, establish readiness, then retire the previous revision. |

PostgreSQL and RabbitMQ always use recreate deployment.

Surge requires sufficient spare capacity and an application that tolerates overlapping instances. For workers, this includes tolerating concurrent execution across revisions.

One `DeploymentService` dispatches web and worker rollouts by resource type and configured strategy, and owns deployment progress and outcome logging. Web recreate/surge strategies own route withdrawal and acceptance; the worker strategy owns replica retention, replacement and retirement without routing. Both use `DeploymentContainers` for candidate creation, readiness and cleanup. Reconcilers own drift detection and retry scheduling.

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

Web and worker deployments share startup readiness and candidate cleanup mechanics. Readiness allows 30 checks per container with one second between unsuccessful checks. Failed startup removes only candidates created by that attempt; cleanup attempts every candidate, removing each only after its graceful stop succeeds. If cleanup also fails, the reported aggregate retains both the original startup failure and cleanup failures. Ready web candidates remain running after uncertain route publication, and accepted replacements remain running when predecessor retirement fails.

`DeploymentContainers` owns creation-option mapping, startup, readiness configuration and cleanup of each failed candidate. Callers supply resolved environment values, image and network identities and retain rollout ordering and route publication. Worker rollout keeps a ledger of earlier ready candidates so a later replica's creation or startup failure also cleans those candidates, preserving all failures. Readiness checks for retained workers do not take ownership of their cleanup.

### Replicas and load balancing

Web and worker resources may specify `replicas`, defaulting to `1`.

Envoy distributes web traffic across ready replicas. Worker replicas run independently and require application-level coordination where necessary.

A stable service URL remains unchanged as containers are replaced.

## Health checks and termination

Web resources accept:

```yaml
healthcheckUrl: /healthcheck
```

The URL is relative to the configured application port. Only an explicitly configured URL enables HTTP checks; only HTTP `200` indicates readiness, matching Envoy's health checks. Omitting `healthcheckUrl` or setting it to undefined or null disables startup and periodic HTTP probes and Envoy active health checks. Resource health then depends on the expected number of containers being running. Rollout readiness still requires a running container with a service-network address so web routing and worker connectivity can be established. Disabling checks allows traffic and surge predecessor retirement before the application begins accepting requests.

This replaces the previous implicit `/healthcheck` default. Descriptors that relied on that default must explicitly set `healthcheckUrl: /healthcheck` to retain HTTP checks. Changing between disabled and enabled checks changes the resource specification and triggers replacement. Omission and null have the same specification identity. Persisted routes retain their existing explicit check paths until reconciliation republishes the resource endpoint; absent paths remain disabled when read from state.

Health-check timing, startup allowance, and failure thresholds are managed by the platform.

Only ready web containers receive Envoy traffic.

Workers use the [private health-check fields](configuration.md#service-descriptors). With an explicit URL, PaaS requires a running container with a service-network address and an HTTP `200` response from every replica before reporting readiness. Startup allows 30 attempts per replica, one second apart, with the shared two-second HTTP timeout. Each eligible reconciliation pass probes unchanged workers with configured checks again; failed health checks report failure and use the normal retry backoff. A health failure alone does not restart a running container. Envoy does not probe or route worker health endpoints. PostgreSQL and RabbitMQ use platform-managed health checks.

Resources may configure graceful termination:

```yaml
termination:
    timeoutSeconds: 60
```

When omitted, the platform uses its default timeout. Containers receive a graceful stop signal, followed by forced termination if the timeout expires. Applications are responsible for finishing existing requests during graceful shutdown.

The control plane waits for Docker stop requests for the configured termination timeout plus five seconds for the Engine response (305 seconds for a 300-second termination timeout). Other Docker operations retain the platform's 120-second request deadline.

The platform does not guarantee uninterrupted long-lived streams or connections during deployment.

## Git reconciliation

Each configured repository is checked every configured polling interval.

The platform fetches the configured branch and reads the descriptor from a specific commit. The entire descriptor is validated before changes are applied.

The reconciler must:

- Run at startup, on changed desired inputs, retry deadlines and targeted Docker/audit findings.
- Compare desired configuration with actual managed resources.
- Recover stopped or missing containers.
- Serialize deployments within each service.
- Label Docker objects with service, resource, and revision identities.
- Persist deployment state so interrupted operations can resume safely.
- Retry failed operations with bounded backoff.
- Expose desired revision, active revision, independent sync and health statuses, and actionable errors.

Git failures and invalid descriptors preserve the last working deployment.

`ReconciliationScheduler` is the runtime entry point for selected service work, including Git refresh and API redeploy. `ReconcilerService.reconcileOne` serializes fresh Docker repair using validated desired inputs, persists deployment checkpoints and invokes each resource reconciler even when Git is unchanged. Failures retain sanitized diagnostics and do not prevent other services from reconciling. State-store failures prevent deployment, report independently and retain scheduler recovery. The compatibility `reconcile` method is reserved for explicit controlled passes/tests; no periodic runtime runner calls it.

`GitClient` owns bare-repository initialization, shallow branch fetches, local repository discovery, commit resolution, and committed-file reads. It translates infrastructure failures into sanitized `GitClientError` values. Its injected `NodeGitTransport` owns filesystem calls and noninteractive Git subprocesses, bounded by the configured operation timeout and a 1 MiB output limit. `GitService.fetchFile` owns service-scoped cache directories and the remote/local workflows, using the branch defaults defined in [configuration](configuration.md#implemented-deployment-mvp). It returns only the revision and content; invalid service identities or file paths reject with `GitServiceError`. Callers must serialize reads for each service because remote fetches share its repository's `FETCH_HEAD`.

### Container updates and images

Existing containers should be updated in place where Docker supports the change safely. Changes to images, environment variables, commands, or mounts generally require replacement.

Images are pulled when first creating a resource or deploying a changed image reference. Development images tagged `:local` use an already loaded Docker image when available. Full local image IDs (`sha256:` followed by 64 lowercase hexadecimal characters) are inspected without a registry pull; an absent ID fails with not-found. Container creation uses the resolved local image identity.

[Image tag variables](configuration.md#image-tag-variables) resolve from the same fixed source commit as the descriptor, before any workload changes. A changed commit prefix changes the desired image reference and triggers the normal replacement flow; unchanged resolved references retain existing reconciliation behavior.

Periodic detection of changed content behind an unchanged image tag is not required. Image tagging policy belongs to each service.

### Docker disk cleanup

The control plane runs host-wide Docker cleanup at startup and every six hours after the previous run completes, equivalent to `docker system prune --all` without `--volumes`. It removes all stopped containers, unused networks, all images without an associated container (including tagged images), and unused build cache. This includes Docker resources outside the platform's labels. Docker volumes, persistent host storage and generated credentials are retained.

Cleanup runs independently of deployments; a rare race can remove a newly pulled image or a newly created stopped container before deployment uses it. Normal reconciliation retries recover these failures. Unused local-only images can also be removed and must be reloaded before later deployments. Cleanup does not overlap itself. Failures are logged and retried on the next six-hour run; shutdown waits for an in-flight cleanup. Successful runs log reclaimed bytes. Cleanup reclaims unused Docker data but does not bound application logs or persistent storage growth.

The startup/six-hour disk job also cleans recognized obsolete internal output. It removes unused shared Git repositories, unconfigured services' state, event, health and route files, old service-keyed Git caches, `_paas/ui-git/`, `__paas/static/`, the unused `/etc/homelab-paas/envoy.yaml`, and old root-level `_paas/{cds.yaml,lds.yaml,sds.yaml,ingress.pem}`. It withdraws unconfigured services' persisted routes through the serialized networking service before deleting their static publications. For configured services, static files and manifests are retained when named by a valid committed descriptor or persisted static route; unavailable descriptors preserve all publications for that service. Routing or source changes invalidate the static cleanup plan, and publications created during plan preparation are retained.

Internal filesystem cleanup excludes active Git, static and atomic-file operations. Recognized abandoned atomic-write and staging files are removed; a static rollback backup is retained while a manifest lacks its published directory. Unknown files are left alone. Filesystem failures fail that cleanup pass and retry on the next run, independently of Docker-prune failures. Application bind-mount data, service secret files, SSH deploy keys, current ingress TLS material, the ACME account key and generated resource credentials are never cleanup targets. `_paas` is reserved for internal platform output and must not be used for service-owned volumes.

### Removal

Removing a resource stops and removes its containers. Removing a service stops and removes all its resource containers.

Service removal from platform configuration is implemented. At startup and on every safety audit (including the 15-minute check), the control plane freshly inventories running and stopped workloads labelled for its cluster, including services absent from configuration. Accepted UI saves and file reloads that remove a service also request this scan immediately after publication; failed validation or persistence cannot request cleanup. File edits take effect after the existing periodic reload accepts them.

Cleanup waits for queued and in-flight deployment work to settle before inventory so a deleted service's active deployment cannot leave a later container behind. It rechecks current service membership before each stop and removal. Containers require complete cluster, service, resource, revision and specification labels; infrastructure roles, incomplete identities and other clusters are excluded. Existing lifecycle helpers freshly verify ownership before mutation. Cleanup gracefully stops each orphan with a 30-second timeout, then removes it without deleting Docker volumes. Deleted descriptors are not required. Failures do not prevent attempts on other containers, are logged, and are retried by the next safety audit. Overlapping scans serialize and retain a subsequent scan; shutdown discards pending work and settles active cleanup.

This service-removal pass retains service networks and leaves persisted artifacts to the [six-hour cleanup](#docker-disk-cleanup). Removal of individual resources from a retained service descriptor remains deferred; cleanup preserves static publications still named by desired configuration or persisted routes.

Persistent data and generated credentials are retained.

Reverting the Git change recreates the resource using retained storage and credentials. Compatibility between retained data and the restored image remains the operator’s responsibility.

See [configuration](configuration.md) for descriptor formats and secret resolution, [networking and authentication](networking-and-auth.md) for Envoy boundaries, and [managed resources](managed-resources.md) for retained data and credential rules.
