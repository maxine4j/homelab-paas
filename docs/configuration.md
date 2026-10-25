# Configuration

Platform and service configuration contracts, including defaults and complete examples. See [architecture](architecture.md) for the host filesystem layout.

All platform and descriptor YAML is parsed through the canonical backend YAML utility. Syntax errors, duplicate keys, unresolved tags and other parser warnings fail validation; failures never include source excerpts or credential values. See [development](development.md#backend-infrastructure-boundaries) for the implementation boundary.

## Implemented deployment MVP

The current runtime supports one or more workload resources per service: any number of `web` resources with one replica each, and any number of `worker` resources with positive integer replica counts. Worker-only services are supported without auth/TLS. Both workload types support `recreate` or `surge` deployment. Descriptors use the schema below with only `version`, `metadata`, and `resources` at the top level. Runtime-supported web fields are `type`, `image`, `ingress`, `primary`, optional `replicas: 1`, `rolloutStrategy` (`recreate` or `surge`), `healthcheckUrl`, `command`, literal or secret-reference `env` values, `volumes`, `hostPorts`, `devices`, `supplementaryGroups`, `limits`, and `termination.timeoutSeconds` (default 30, maximum 300). Workers support the same application settings, with `healthcheckPort` instead of `ingress` and multiple replicas. Unknown fields fail descriptor validation; unsupported runtime features fail a separate capability check before changing workloads. The public TypeScript types, Zod schema, and `parseDescriptor` validator in `@homelab-paas/shared-contracts` describe the complete service descriptor contract below. Platform configuration, runtime capability checks, and deployment state stay in the backend.

Managed databases/brokers, egress, web replicas beyond one, and resource/service removal are deferred. Private ingress (including the default `public: false`) requires platform auth and TLS. Without them, ingress must explicitly set `public: true`. The remaining service examples include capabilities beyond the deployed runtime.

Both workload types also support explicit [TCP and UDP host ports](#host-ports), restricted to one replica and recreate deployment.

At startup and on reload, supplied environment variables override the corresponding YAML fields before validation:

| Environment variable     | YAML field                     |
| ------------------------ | ------------------------------ |
| `GITHUB_CLIENT_ID`       | `auth.github.clientId`         |
| `GITHUB_CLIENT_SECRET`   | `auth.github.clientSecret`     |
| `SESSION_SIGNING_KEY`    | `auth.session.signingKey`      |
| `DIGITALOCEAN_API_TOKEN` | `tls.dns.credentials.apiToken` |
| `ACME_EMAIL`             | `tls.acme.email`               |

Unset variables preserve YAML values; empty overrides fail validation when their section is configured. Environment credentials alone do not enable authentication or TLS. The YAML must still contain the corresponding sections, GitHub allowlist and session settings. Keep local credentials in the ignored Compose `.env` file; see [development](development.md#local-container-environment).

Platform configuration contains `version: 1`, `metadata.clusterId`, `ingress.baseDomain`, optional `ingress.httpPort` (default 80), `git`, `reconciliation`, and `services`. The `auth` and `tls` sections shown below are optional together; supplying only one fails startup. With both enabled, `ingress.httpsPort` defaults to 443 and HTTP redirects to HTTPS. HTTP and HTTPS ports must differ. Without auth/TLS, `httpsPort` is rejected and public HTTP remains available for local development. Git credentials remain deferred. Polling, operation timeout, and retry bounds are required positive integer seconds.

GitHub client ID, client secret, and a nonempty username allowlist are required when authentication is enabled. Username matching is case-insensitive. `AuthService` derives the callback as `https://auth.{baseDomain}/auth/callback`, including `:{httpsPort}` for a nonstandard HTTPS port; `callbackUrl` is not a configurable field. Register this derived URL in the GitHub OAuth application. The service ID `auth` is reserved in this mode. Session issuer, audience, signing key (at least 32 characters), and positive integer lifetime in seconds are required. TLS requires an ACME email and DigitalOcean API token; provider selection is fixed to `digitalocean`. Certificate paths, production ACME directory, and renewal timing are platform-owned; see [TLS](networking-and-auth.md#tls).

For normal remotes, `branch` defaults to `main` and `descriptorPath` defaults to `{serviceId}.sd.yaml` relative to the repository root. Git fetches the configured branch into platform-owned repositories and reads the descriptor at its resolved commit.

The magic remote `local` reads an existing Git repository on the control-plane container's filesystem. It requires an absolute `descriptorPath`; the enclosing repository is discovered with Git. An omitted branch means the mounted repository's `HEAD`, including its currently checked-out branch. An explicit branch selects that local ref. Descriptors are always read with `git show` at a resolved commit; uncommitted edits are ignored. This mode does not fetch or read the YAML directly from the working tree.

```yaml
version: 1
metadata:
    clusterId: local
ingress:
    baseDomain: localhost
    httpPort: 80
git:
    pollIntervalSeconds: 5
    operationTimeoutSeconds: 60
reconciliation:
    retryBackoffSeconds: 5
    maxRetryBackoffSeconds: 60
services:
    test-service:
        remote: local
        descriptorPath: /mnt/repo/services/test-service/test-service.sd.yaml
```

## Platform configuration reload

`PaasConfig` owns the effective configuration. Control-plane components read it through typed getters, including `getTlsConfig`, rather than retaining startup copies. After startup, a serial background task rereads `/etc/homelab-paas/config.yaml` every 60 seconds through the canonical file reader. Reload requires read access and no filesystem notification subscription, including on SELinux-enforcing CoreOS. Management edits additionally require a writable configuration directory; see below. Keep the mounted directory accessible under the production SELinux policy; update the file atomically within that directory.

Each read reapplies the process environment overrides, parses YAML, validates the complete candidate and publishes it atomically. Missing files, read/parse/validation failures and restart-required changes retain the entire last valid configuration and log an error with its cause. Startup still fails if the initial configuration cannot load. Getters return independent values so callers cannot mutate the stored configuration.

Service sources, Git polling/operation timing, retry bounds, auth credentials, allowlists, session settings and TLS credentials/email take effect on subsequent operations. An already scheduled reconciliation wait or in-flight operation may finish using previous settings. Signing-key changes invalidate existing sessions and OAuth state; allowlist changes apply on the next session check. TLS settings apply on the next required certificate issuance/renewal, without replacing a healthy certificate solely for a credential change. Environment overrides remain fixed until the process restarts.

Cluster identity, ingress domain/ports and enabling or disabling auth/TLS require a control-plane restart; reload rejects the whole candidate when these differ. Update external DNS, OAuth registrations and bootstrap port mappings as appropriate before restarting. Adding a service makes it eligible for the next reconciliation pass. Removing a service stops its reconciliation and removes it from the management UI and accepted OAuth targets; workload, route, persistent data and credential cleanup remain deferred under the [removal contract](reconciliation-and-deployments.md#removal).

### Management edits

The [management editor](management-ui.md) changes live settings and service sources through `PaasConfig.updateConfig`. `getEditableConfig` returns a redacted effective snapshot, an opaque disk-content revision, and field metadata. The GitHub client secret, session signing key and DigitalOcean API token have replacement-only inputs: their values are never returned, only whether they are configured. Unchanged or omitted fields retain their original YAML values. Secret replacements must be nonempty and cannot be the redaction marker. Environment-managed fields and restart-required settings are read-only. Values containing redacted credentials are also read-only, preventing redaction markers from overwriting hidden values. Authentication/TLS sections cannot be enabled or disabled in the editor.

The configuration service owns platform-secret redaction for configuration, resource inspection and logs. The UI service supplies descriptor secrets without reading platform credentials to construct its own redaction rules. Runtime consumers use typed getters; there is no full unredacted configuration getter.

Saves and reloads share a serial queue. Before saving, the service checks both the submitted revision and the current disk revision, applies only explicitly changed fields to the disk configuration, reapplies environment overrides, and validates the complete candidate against the reload contract. Stale edits fail without writing. External editors must still coordinate writes: an external file replacement racing after the revision check is outside this in-process serialization guarantee.

The file store serializes YAML and uses the canonical atomic writer to replace the host file with mode `0600`. The mounted directory must be writable to create and rename the restricted sibling temporary file; mounting an individual file is insufficient. A save may normalize YAML formatting and remove comments. Environment credentials are never copied into YAML merely by saving another setting. Only after a successful write does the service publish the complete effective candidate. Validation and write failures retain the previous effective configuration. Successful saves return only a redacted snapshot and take effect on subsequent consumer operations, with the same in-flight behavior as reloads.

The editor preserves dirty drafts across polling refreshes. On a conflict, reload the editor snapshot and reapply changes; external disk edits become visible after the periodic reload accepts them. Rotating the signing key invalidates existing sessions, including the editor's session, on subsequent requests.

## Service descriptors

Each configured service has a descriptor named:

```text
{serviceId}.sd.yaml
```

The filename and repository path may be overridden in the platform configuration.

A service groups related resources—for example, an application, worker, database, and queue.

Service and resource IDs must use lowercase kebab case:

```text
^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
```

The descriptor’s `metadata.serviceId` must match its key in the platform configuration.

Each service may contain multiple web resources. With more than one, exactly one must explicitly set `primary: true`; omitted or `false` values select secondary resources. A sole web resource is implicitly primary, including when `primary` is omitted or explicitly `false`. Worker-only services need no primary. Each web resource has its own [external hostname](networking-and-auth.md#external-ingress-and-authentication); the primary also receives the service hostname. Primary selection changes routing without replacing otherwise unchanged containers.

```yaml
resources:
    app:
        type: web
        primary: true
        image: app:1
        ingress: { port: 3000, public: true }
    admin:
        type: web
        image: admin:1
        ingress: { port: 8080, public: false }
```

Resources are a discriminated union of `web`, `worker`, `postgres`, and `rabbitmq`. Every resource requires a nonempty `image` and may set `limits` and `termination.timeoutSeconds` (positive integer seconds, maximum 300). Web and worker resources additionally accept `command`, `env`, `volumes`, [devices and supplementary groups](#devices-and-supplementary-groups) (`devices`, `supplementaryGroups`), `hostPorts`, `egress`, positive integer `replicas` (default 1), and `rolloutStrategy` (`recreate` by default, or `surge`). Web resources require an ingress port (1–65535) and default `ingress.public` to `false`. Workers require `healthcheckPort` (integer 1–65535) and reject `ingress`. Both default `healthcheckUrl` to `/healthcheck`, accepting only a relative HTTP path beginning with a single `/`. PaaS probes worker health endpoints on the container's service-network address; no host port, public route, or Envoy health check is created automatically. Workers must listen on that container interface, rather than only loopback. See [health checks](reconciliation-and-deployments.md#health-checks-and-termination) for readiness and polling behavior. Managed PostgreSQL and RabbitMQ resources accept no custom environment, credentials, volumes, devices, supplementary groups, replicas, or rollout strategy; see [managed resources](managed-resources.md).

## Host ports

Web and worker resources may explicitly publish fixed TCP and UDP ports through Docker Engine:

```yaml
replicas: 1
rolloutStrategy: recreate
hostPorts:
    - protocol: tcp
      containerPort: 8096
      hostPort: 8096
      bindAddress: 127.0.0.1
    - protocol: udp
      containerPort: 7359
      hostPort: 7359
      bindAddress: 0.0.0.0
```

Every mapping requires `protocol` (`tcp` or `udp`), integer `containerPort` and `hostPort` in 1–65535, and an explicit literal IPv4 or IPv6 `bindAddress` without brackets or a zone identifier. Hostnames, dynamic ports, and port ranges are unsupported. The address refers to the Docker host. `127.0.0.1` and `::1` restrict publication to host loopback; `0.0.0.0` and `::` request wildcard publication. Actual IPv6 availability and dual-stack behavior depend on the Docker host and Engine configuration. Multiple host bindings may target the same container port. TCP and UDP may use the same numeric host port.

Omitted or empty `hostPorts` publishes nothing. Fixed bindings require exactly one replica and `recreate`; descriptors combining them with `surge` or more replicas fail validation. Adding, changing, or removing a binding replaces that resource. Recreate releases previous bindings before starting replacements, with expected downtime and no rollback guarantee if the new bind fails.

Validation rejects overlapping host address/port/protocol bindings anywhere within one descriptor before any workload changes. Equivalent IPv6 addresses and IPv4-mapped IPv6 addresses are compared canonically; the IPv6 wildcard is conservatively treated as overlapping both address families. Across services, other clusters, bootstrap containers, and existing host listeners, Docker remains the authority. An unavailable address, occupied port, or unsupported host configuration fails creation/startup and uses normal reconciliation retries; the platform does not reserve host ports in advance.

Published host traffic connects directly to the application. It bypasses Envoy authentication, TLS termination, routing, cookie stripping, and readiness gating, even when web ingress is private. Bindings become reachable when Docker starts the container and the application listens, potentially before readiness succeeds, and remain reachable if later health checks fail. Applications and operators own authentication, encryption, firewall rules, and exposure for these ports. HTTP health checks still use the service network; UDP application readiness requires application-specific handling. Host publication also permits communication outside the service-network isolation boundary. It does not configure host networking, multicast forwarding, or device access.

## Environment variables and secrets

Web and worker resources may declare literal values or secret references:

```yaml
env:
    - name: FOO
      value: "123"
    - name: EXTERNAL_API_TOKEN
      secret: true
```

Literal values must be strings without NUL bytes. Environment names must be unique within a resource.

Secret references resolve by variable name from:

```text
/etc/homelab-paas/env/{serviceId}.env
```

For example, service `example-service-id` reads `/etc/homelab-paas/env/example-service-id.env`. This path must be readable inside the control-plane container; mount the configuration directory there. Service IDs follow the lowercase kebab-case identity rule above.

The file uses a strict single-line dotenv format: `NAME=value`, with optional whitespace around the name, equals sign and value. Blank lines and `#` comments are accepted. Single or double quotes preserve spaces and `#` within a value; values are literal, with no interpolation, escape processing, shell evaluation, `export` prefix, or multiline quoted strings. An empty assignment is a valid empty secret. Duplicate names, malformed assignments, unmatched quotes and NUL bytes fail resolution. Only variables explicitly declared by the descriptor are injected; unused file entries are ignored after syntax validation. Literal-only workloads do not require a secret file.

Missing, unreadable or invalid files and missing required names fail deployment before any workload or route changes. An existing working revision remains active. Failures use sanitized messages and the normal reconciliation retry backoff. Keep these operator-managed files restricted and update them atomically.

Secret-resolution failures distinguish missing files, unreadable files, invalid dotenv syntax and missing variables. Diagnostics list all missing declared secret names, identify the container file path, and report the line for malformed or duplicate assignments. They never include file contents or secret values. On failure, the control plane inspects its cluster's uniquely identified running control-plane container and resolves the most specific Docker bind mount to report the actual host file to edit. Production's default mount maps the path above unchanged; local/custom mounts may map it elsewhere. Named volumes, absent/ambiguous container identities and unavailable Docker inspection leave the host path explicitly unavailable rather than assuming it equals the container path. These details are retained in [service events](reconciliation-and-deployments.md#service-events) and shown in both [management event views](management-ui.md#service-events).

Secret files are read again on every eligible polling pass, even when Git has not changed. The resource specification fingerprint includes resolved environment values; changes to referenced values replace containers using the selected rollout strategy. Unchanged resolved values and changes to unused entries do not replace containers. Raw values are never written to deployment state, labels or UI snapshots; labels contain only the specification hash. Operator failure logs follow the [backend logging contract](development.md#backend-logging).

Platform-generated environment-variable names are reserved. Conflicting user declarations fail validation.

## Volumes and resource limits

Web and worker resources may declare persistent volumes:

```yaml
volumes:
    - hostPath: /srv/example/uploads
      mountPath: /app/uploads
      readOnly: false
```

`hostPath` is an arbitrary absolute path on the **Docker host**, including paths outside `/var/homelab-paas/`. Workloads and descriptor authors are trusted to choose host files or directories. `mountPath` is an absolute path inside the workload container, other than `/`; mount destinations must be unique and neither path may contain NUL bytes or colons (Docker's bind-string separator). `readOnly` defaults to `false`. The old `source` and `target` fields are rejected.

Docker bind mounts use these paths directly through the Engine API's `HostConfig.Binds`, with explicit `ro` or `rw` access and the shared SELinux `z` option. Docker relabels the source for access by multiple confined containers, including overlapping surge revisions. This changes host SELinux labels recursively, even for read-only mounts; choose dedicated application paths rather than system directories or paths requiring a different host policy. Unix ownership and permissions still apply.

The control plane does not create, inspect or translate host paths using its own container filesystem. Docker creates missing source directories when starting a container; provision file sources and any required application ownership or permissions on the host before deployment. Unusable sources fail container creation or startup. Data belongs to the host and is retained when containers or resources are removed. Mount and access-mode changes trigger replacement. With `surge`, both revisions access the same host data concurrently; use `recreate` for applications that require exclusive access.

Resources may declare CPU and memory limits:

```yaml
limits:
    cpus: 1
    memoryMiB: 512
```

Both fields are optional. `cpus` is a positive CPU count (fractional values allowed), mapped to Docker `HostConfig.NanoCpus` by rounding `cpus × 1,000,000,000`. It must be at least one nanocpu and fit a safe integer after conversion. `memoryMiB` is a positive integer mapped to Docker `HostConfig.Memory` in bytes (`memoryMiB × 1,048,576`), also bounded to safe integer conversion. Omitted fields leave Docker's defaults in effect. Docker enforces additional host-specific minimums and capacity restrictions; invalid settings fail deployment. Limit changes replace containers through either rollout strategy.

## Devices and supplementary groups

Web and worker resources support simple Docker host device mappings, including Intel Quick Sync for applications such as Jellyfin:

```yaml
devices:
    - hostPath: /dev/dri
      mountPath: /dev/dri
      permissions: rwm
supplementaryGroups:
    - 44 # Example video GID; use the actual Docker host GIDs
    - 109 # Example render GID
```

`hostPath` names an existing device node or device directory on the **Docker host**; `mountPath` is its destination inside the workload container. Both must be absolute normalized paths other than `/`, without empty, `.` or `..` segments, trailing slashes, NUL bytes or colons. Device destinations must be unique. Docker maps directories' existing device nodes; newly added host nodes require container replacement. `permissions` defaults to `rwm` and accepts a nonempty subset in `r`, `w`, `m` order: read, write and device-node creation access in the device cgroup. These permissions do not override Unix ownership or mode bits.

Optional `supplementaryGroups` adds unique numeric Linux GIDs (0 through 4294967294) to the container process, allowing the image's configured user to access group-owned devices. Obtain the actual GIDs from the Docker host's device ownership; group names and image group IDs may differ. Image entrypoints that switch users and drop supplementary groups may require image-specific configuration to preserve device access. Group ordering is immaterial. Neither option is available on managed PostgreSQL or RabbitMQ resources.

The Engine API receives `HostConfig.Devices` and `HostConfig.GroupAdd`. Device mappings are separate from ordinary bind volumes and do not apply the volume SELinux `z` relabel option. The operator must provision compatible host drivers, application/image hardware acceleration support, device permissions and any required SELinux device-access policy. The control plane neither changes the host nor checks device existence through its own filesystem; Docker reports unavailable devices or denied access through normal deployment failures and retries.

Device paths, permissions and supplementary group changes replace web and worker containers with the configured rollout strategy. Devices may be shared between replicas and surge revisions; use recreate and one replica where the device or application requires exclusive access. Omitted or empty device/group lists retain the existing workload specification identity. Privileged containers, NVIDIA runtimes/device requests and GPU scheduling are outside this contract.

## Example platform configuration

```yaml
version: 1

metadata:
    clusterId: prod

ingress:
    baseDomain: apps.example.com
    httpPort: 80
    httpsPort: 443

auth:
    github:
        clientId: replace-me
        clientSecret: replace-me
        allowedUsers:
            - your-github-username

    session:
        issuer: homelab-paas
        audience: homelab-paas
        signingKey: replace-with-a-long-random-secret
        ttlSeconds: 43200

git:
    pollIntervalSeconds: 120
    operationTimeoutSeconds: 60

reconciliation:
    retryBackoffSeconds: 10
    maxRetryBackoffSeconds: 300

tls:
    acme:
        email: admin@example.com
    dns:
        provider: digitalocean
        credentials:
            apiToken: replace-me

services:
    example:
        remote: git@github.com:example/example.git
        branch: main
        descriptorPath: example.sd.yaml
        credentials:
            sshPrivateKeyPath: /etc/homelab-paas/git/id_ed25519
            knownHostsPath: /etc/homelab-paas/git/known_hosts

    another-service:
        remote: https://github.com/example/another-service.git
        # branch defaults to main
        # descriptorPath defaults to another-service.sd.yaml
```

## Example service descriptor

```yaml
# example.sd.yaml
version: 1

metadata:
    serviceId: example
    description: A web application, worker, database, and queue
    labels:
        owner: homelab

resources:
    app:
        type: web
        image: ghcr.io/example/app:1.0.0
        replicas: 1
        rolloutStrategy: surge

        ingress:
            public: false
            port: 3000

        healthcheckUrl: /healthcheck # optional; this is the default

        termination:
            timeoutSeconds: 60

        egress:
            - another-service

        env:
            - name: FOO
              value: "123"
            - name: EXTERNAL_API_TOKEN
              secret: true

        volumes:
            - hostPath: /srv/example/uploads
              mountPath: /app/uploads
              readOnly: false

        limits:
            cpus: 1
            memoryMiB: 512

    worker:
        type: worker
        image: ghcr.io/example/app:1.0.0
        healthcheckPort: 8081
        healthcheckUrl: /healthcheck
        command:
            - node
            - dist/worker.js
        rolloutStrategy: recreate

        egress:
            - another-service

        termination:
            timeoutSeconds: 60

        limits:
            cpus: 0.5
            memoryMiB: 256

    store:
        type: postgres
        image: postgres:17

        limits:
            cpus: 1
            memoryMiB: 1024

    queue:
        type: rabbitmq
        image: rabbitmq:4

        limits:
            cpus: 0.5
            memoryMiB: 512
```

The corresponding user-managed secret file contains only application secrets:

```dotenv
# /etc/homelab-paas/env/example.env
EXTERNAL_API_TOKEN=replace-me
```

Database and broker credentials are generated, persisted, and injected automatically.

See [networking and authentication](networking-and-auth.md) for ingress and egress behaviour, [reconciliation and deployments](reconciliation-and-deployments.md) for rollout and health-check fields, and [managed resources](managed-resources.md) for generated connection variables.
