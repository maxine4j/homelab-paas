# Configuration, state, secrets, and storage

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing bootstrap settings, canonical configuration writes, credentials, controller persistence, storage paths, aliases, retention, or backup procedures.

Read related requirements only when the change crosses those boundaries: [access and ingress](access-and-ingress.md), [GitOps](gitops.md), [reconciliation](reconciliation.md).

## Configuration, state, and storage

Default host layout:

```text
/var/homelab-paas/
  _platform/
    config.yaml                # bootstrap and cluster configuration
    secrets.yaml               # user-supplied platform/application secret values
    state/
      controller.yaml          # sole committed controller metadata snapshot
      controller.lock          # stable inode for the lifetime controller lock
    git/                       # fetched repositories and revision snapshots
    k3s/                       # persistent K3s runtime/datastore state
    certificates/              # ACME account, certificate keys, renewal state
    observability/             # monitoring data and generated configuration
  <serviceId>/
    <resourceId>/
      data/                    # database or application persistent data
      secrets/                 # stable platform-generated resource credentials
      volumes/
        <volumeId>/            # additional declared persistent directories
```

- Bind the configured `/var/homelab-paas` storage root into the outer container at the same absolute path. Mount the required paths into the control plane and individual workloads explicitly.
- Nested Kubernetes `hostPath` refers to the node container's filesystem. Host-visible persistence must always be backed by an outer Docker bind mount.
- Reserve `_platform` and platform DNS names. Validate identifiers, lengths, normalization, and collisions before provisioning paths or Kubernetes objects.
- Resolve paths beneath the configured storage root. Reject traversal and symlink escapes. App descriptors cannot choose arbitrary absolute host paths.
- Support administrator-configured external directory aliases for media or other pre-existing host data. A descriptor references an alias and mount mode, not a raw host path.
- Support ConfigMap-backed files, secret-backed files/env vars, ephemeral directories, resource data directories, and named persistent volume directories.
- Configuration loaded from disk and configuration submitted through onboarding must use the same schema and validation path.
- UI changes update the canonical host configuration atomically. Do not maintain a conflicting configuration copy in a private UI database.
- Separate non-secret settings from secret values. Store restrictive file permissions, redact secrets in API responses/logs, and never commit secret values into Git.
- Initial setup is file-based: require the cluster domain, DigitalOcean token, ACME settings, GitHub OAuth2 client ID/secret, registered HTTPS callback URL, separate explicit private-application and administrator username lists, and a non-empty set of discovery owners. Store read credentials as named references to `_platform/secrets.yaml`.
- Configure private-application access as `auth.github.allowedUsernames`, control-plane administration as `auth.github.adminUsernames`, and discovery scope as `gitops.discovery.owners`, whose entries have `type: user | org`, `name`, and a repository-read `credentialRef`. All three scopes are independent: scanning an organization does not grant login access, and allowing a user does not automatically scan their repositories or grant administration.
- Require explicit non-empty username/owner sets at bootstrap, reject malformed names, and normalize GitHub username/owner matching case-insensitively. Never populate these sets from the first browser login or repositories returned by a token.
- Validate bootstrap configuration before issuing certificates or accepting login. Missing/invalid settings produce actionable local diagnostics and leave management access unavailable; do not start a public setup wizard or grant administration to the first visitor.
- Generate dependency credentials once and persist them. Restart, reconciliation, and redeployment must not regenerate passwords.
- Reconcile only the secrets a resource is entitled to consume into its namespace. Enable Kubernetes secret encryption at rest during bootstrap.
- Define config reload and secret rotation behaviour explicitly. Env-var changes require workload replacement; file changes still require application-specific reload handling.
- Retain persistent data and generated credentials when a descriptor or resource is removed. Destructive purge must be an explicit administrator action distinct from normal reconciliation.
- Do not assume a raw copy of a running database directory is a consistent backup. Each managed resource needs documented backup and restore procedures, including its credentials and metadata.
- Automated backup scheduling and remote backup destinations require a separate scope decision; do not imply they exist merely because data is persistent.

## Authoritative state and controller records

Host `config.yaml` owns cluster/bootstrap/access/discovery settings; referenced host secret files own supplied secret values. Git owns enrolled application desired state. The controller's `state/controller.yaml` owns candidates/ignore decisions, approval audit, enrollments/pinned sources, stop/rebind decisions, installation/service/resource identities, reservations, inventory, revision transitions, operation progress, and retention tombstones. Store accepted normalized Git snapshots with immutable revisions/digests for restart recovery; these are materialized Git versions, never UI overrides. Kubernetes owns live objects/UIDs/resource versions and observed conditions; cached observations are replaceable, not evidence of enrollment.

Generated credentials remain authoritative in resource `secrets/` files; inventory stores references and materialization progress, and Kubernetes Secrets are scoped copies. Application data/volumes, certificates/ACME material, Git caches, observability data, and K3s state remain in their specified directories with separate lifecycle/backup boundaries. No SQLite or additional database server is used for controller metadata.

Use one YAML snapshot to commit related metadata together. Its envelope contains a store schema version, monotonic commit generation, and stable installation ID/cluster binding. Typed records contain kind/version, stable identity, record generation, and explicit operation/result variants. Validate references and uniqueness and reject duplicate keys, unsupported versions, malformed records, and stale expected generations. Bound snapshot size, record counts, parsing, queues, and history; reject mutations at capacity rather than discarding enrollment, pending work, or retained inventory. Concrete limits and Rust libraries remain implementation choices. Keep secret values, raw repositories, logs, metrics, and watch streams out of the snapshot; descriptors may contain secret references only.

## Atomic metadata commits and interrupted writes

Serialize mutations through one bounded writer; run disk and serialization work outside Tokio executor threads. Validate the complete next snapshot before writing. Readers see the last committed immutable in-memory snapshot.

1. Exclusively create a unique temporary file in the state directory without following symlinks. Validate containment/ownership and use `0700` directories and `0600` files; never truncate `controller.yaml` in place.
2. Write the complete snapshot, flush buffers, and sync the file.
3. Atomically rename it over `controller.yaml` on the same filesystem.
4. Sync the state directory before publishing the new in-memory generation, acknowledging success, or starting effects that depend on it. Sync parent entries when first creating state directories.

Require a local persistent filesystem supporting atomic rename, file/directory sync, and OS locking, backed by the host bind mount. Network filesystems and ephemeral container layers are unsupported for controller metadata.

Failure before rename preserves the old commit. Failure after rename but before directory sync is an indeterminate commit: stop further writes/effects, surface an actionable error, and recover the validated committed path on restart. Do not continue from an old in-memory generation or acknowledge durable success. Resolve lost responses using stable operation IDs rather than creating new identities. Already in-flight effects may finish; their durable intents allow inspection on recovery.

After taking the lifetime lock, load and validate only `controller.yaml`; never promote temporary files by timestamp. Discard abandoned temporary snapshots only after validating committed state. Missing/corrupt state on an existing installation fails closed; do not reconstruct approvals from Kubernetes or regenerate identities. Initialize only a verified fresh installation without prior managed state; ambiguous cases require operator recovery. Refresh Kubernetes observations and resume pending intents before new effects.

## Singleton lifecycle

Acquire an exclusive nonblocking OS lock on `controller.lock` before initialization, recovery, migration, management mutation, or background effects. Keep the descriptor open for the entire process lifetime with close-on-exec. Never unlink or replace the lock inode. A competing controller exits with an actionable already-running error. PID files and replica counts are not substitutes.

All controllers and offline repair/migration tools must share the canonical mounted state directory and honor the same advisory lock. Separate state roots targeting one cluster are unsupported; verify installation/cluster binding before mutation. Shutdown stops new mutations, cancels and awaits workers and disk commits, then releases the lock. Replacement stops the previous controller first; no worker may perform effects after lock release. An OS-released lock after a crash permits recovery by the successor.

## Migrations, credentials, and restore

Run explicit ordered schema/record migrations under the lifetime lock before management mutations or reconciliation. Reject newer schemas and unsupported older versions without rewriting them. Before migrating, write, validate, and sync a restrictive backup of the committed snapshot and sync its directory. Transform in memory, validate cross-record invariants and unchanged identities, then publish the entire migrated snapshot through the atomic commit protocol. Never migrate records in place or regenerate identities, accepted revisions, or credentials. Failure stops startup without external effects; a crash leaves an old or new complete committed version. Do not silently restore a stale backup after newer operations may have run. Safe downgrade after migration is not promised.

Before creating paths/credentials or provisioning dependencies, persist their stable identities and pending intents. Materialize generated credentials atomically without overwriting existing files; sync file and directory before external use. Recovery validates and reuses existing credentials. Missing/corrupt credentials for an already provisioned resource require recovery, never password regeneration. Record results only after observing effects; failed result commits leave pending intents for inspection.

Manual metadata repair and restore require a stopped controller and validated state before restart. Restore metadata with matching host configuration, secrets/certificates, K3s state, and resource-specific data backups; verify installation/cluster identity and refresh observations. The metadata snapshot alone is not a database backup. Session persistence, configuration reload, rotation behavior, backup scheduling, and remote destinations remain separate decisions.

Ordinary removal retains resource directories, credential files, aliases, persistent volumes/claims, service namespaces, tombstones, and identity/path reservations. Use explicit `Retain` PV reclaim policy and no disposable owner-reference chains for retained objects. A different source cannot silently acquire retained state. Re-enrollment/reuse policy remains a separate product decision; destructive purge requires its own explicit administrator operation.

## Host configuration shape

Complete bootstrap settings shape (secret values belong only in the separate host file):

```yaml
clusterDomain: example.com
tls:
  digitalOceanTokenRef: digitalocean-dns
  acme:
    environment: staging # staging | production (Let's Encrypt)
    email: admin@example.com
auth:
  github:
    clientId: your-github-oauth-client-id
    clientSecretRef: github-oauth
    callbackUrl: https://paas.example.com/api/auth/callback
    allowedUsernames:
      - example-user
    adminUsernames:
      - example-admin
gitops:
  discovery:
    owners:
      - type: user
        name: example-user
        credentialRef: github-personal-read
      - type: org
        name: example-org
        credentialRef: github-org-read
```

Credential references resolve on the host; they are not browser OAuth2 access tokens or values checked into application repositories. `_platform/secrets.yaml` is a flat mapping of credential names to non-empty string values. Supply `digitalocean-dns`, `github-oauth`, `github-personal-read`, and `github-org-read` for the example above. Never commit that file. Use mode `0600` (or read-only `0400`) and make it readable by the control-plane OS user. Files and the `_platform` directory must be real entries beneath the configured storage root, without symlinks. Both files are bounded to 1 MiB and reject duplicate YAML keys; settings reject unknown fields and inline secret fields.

The domain uses ASCII DNS labels (1–63 characters each, at least two labels, at most 248 bytes including dots); IP addresses, wildcards, and trailing dots are rejected. The callback must use HTTPS on `paas.<clusterDomain>`, with a non-empty path under `/api/`, no credentials, query, fragment, or alternate port. This validates the callback shape; the future login implementation owns the concrete callback route, and operators must register its exact URL with GitHub.

GitHub usernames/owner names use 1–39 ASCII letters/digits with single internal hyphens. Matching is normalized to lowercase. Username lists deduplicate within each list; discovery rejects duplicate owner names case-insensitively. Credential names use 1–128 ASCII letters/digits, hyphens or underscores, starting with a letter/digit. Invalid names and missing references report controlled field paths without rejected values. YAML errors report line/column when available and omit parser excerpts and input values.

Owner decision (2026-10-18, CP-03): use `org` consistently as the configuration discriminator; `organization` is rejected. The loader returns a validated immutable configuration view and a separate server-only secret resolver; only configuration references can be serialized. No configuration writer, reload, or credential rotation is introduced here; those remain separate work.

## Required verification

- Inject crashes during temporary writes, file sync, replacement, and directory sync; recover only a complete committed snapshot. Test indeterminate commits and lost responses without duplicate operations or identities.
- Start competing controllers and maintenance tools against the same directory; only the lifetime lock holder may mutate or perform effects. Verify crash release and shutdown ordering, including outstanding disk commits.
- Exercise migration fixtures, crash/failure during migration, full/unwritable storage, unsupported versions, corrupt/missing existing snapshots, and installation/cluster mismatch. Fail closed without regenerating identities or silently restoring stale backups.
- Interrupt credential materialization/publication and result commits; reuse stable credentials and inspect pending effects. Missing/corrupt provisioned credentials must require recovery.
- Restore matching metadata, configuration, secrets, K3s state, and resource-specific backups; refresh observations before new effects. Ordinary removal must preserve retained storage/credentials and reservations.
