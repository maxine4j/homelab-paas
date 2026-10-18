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
    state/                     # discovery, approvals, tracked sources, inventory
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
- Configure private-application access as `auth.github.allowedUsernames`, control-plane administration as `auth.github.adminUsernames`, and discovery scope as `gitops.discovery.owners`, whose entries have `type: user | organization`, `name`, and a repository-read `credentialRef`. All three scopes are independent: scanning an organization does not grant login access, and allowing a user does not automatically scan their repositories or grant administration.
- Require explicit non-empty username/owner sets at bootstrap, reject malformed names, and normalize GitHub username/owner matching case-insensitively. Never populate these sets from the first browser login or repositories returned by a token.
- Validate bootstrap configuration before issuing certificates or accepting login. Missing/invalid settings produce actionable local diagnostics and leave management access unavailable; do not start a public setup wizard or grant administration to the first visitor.
- Generate dependency credentials once and persist them. Restart, reconciliation, and redeployment must not regenerate passwords.
- Reconcile only the secrets a resource is entitled to consume into its namespace. Enable Kubernetes secret encryption at rest during bootstrap.
- Define config reload and secret rotation behaviour explicitly. Env-var changes require workload replacement; file changes still require application-specific reload handling.
- Retain persistent data and generated credentials when a descriptor or resource is removed. Destructive purge must be an explicit administrator action distinct from normal reconciliation.
- Do not assume a raw copy of a running database directory is a consistent backup. Each managed resource needs documented backup and restore procedures, including its credentials and metadata.
- Automated backup scheduling and remote backup destinations require a separate scope decision; do not imply they exist merely because data is persistent.

Required GitHub configuration shape, alongside the existing TLS/OAuth2 settings:

```yaml
auth:
  github:
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

Credential references resolve on the host; they are not browser OAuth2 access tokens or values checked into application repositories. These snippets define configuration shape, not a complete bootstrap configuration.
