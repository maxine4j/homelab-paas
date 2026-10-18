# Platform scope and architecture

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read for product scope, architecture, appliance lifecycle, workspace boundaries, or release acceptance.

Read related requirements only when the change crosses those boundaries: [build and CI](build-and-ci.md), [configuration and storage](configuration-and-storage.md), [reconciliation](reconciliation.md).

## Mission

Build a self-hosted, single-host PaaS that runs as one pre-built Docker appliance managed by systemd. A user configures access and GitHub discovery owners, points wildcard DNS at the host, and approves discovered service descriptors before the platform starts tracking and deploying them.

The platform owns the integration between application deployment, ingress, authentication, TLS, network permissions, persistent storage, secrets, and observability. Application repositories must not need Kubernetes manifests, Helm charts, auth-header configuration, or monitoring annotations.

Support both the owner's web applications and existing containerized homelab applications. Prefer predictable defaults and explicit exceptions over exposing Kubernetes configuration wholesale.

## Confirmed architecture

- K3s supplies Kubernetes, container execution, scheduling, service discovery, and network-policy enforcement.
- Traefik supplies public HTTP ingress and routes authorization checks to the control plane.
- One Rust control plane owns descriptor parsing, Git polling, reconciliation, the custom auth proxy, certificate lifecycle management, secrets provisioning, managed resources, observability configuration, and the management API.
- Axum supplies HTTP routing on Tokio. Use Tokio-compatible asynchronous clients and `tracing` for structured logs and operation spans.
- A React/TypeScript/Vite SPA supplies authenticated onboarding and cluster management. Axum serves the API and the built SPA from the same runtime image.
- Shared Rust/Serde contracts define the canonical data model and validation boundary; generate frontend TypeScript contracts and schemas from that model.
- GitHub OAuth2 supplies browser login. Initial TLS/OAuth2 settings, allowed GitHub usernames, and GitHub discovery owners must be explicitly configured in the host file before web onboarding is available.
- Use GitHub APIs to enumerate repositories owned by configured users/organizations and discover root-level `*.sd.yaml` files. Discovery is read-only; explicit user acceptance enrolls a descriptor for ongoing deployment.
- Deploy through Git polling only. Do not implement Git webhooks.
- Implement the auth proxy and certificate manager inside this project rather than deploying OAuth2 Proxy, cert-manager, or Certbot.
- Use files on the host for configuration and secrets. No cloud secret manager is required.
- Default persistent root: `/var/homelab-paas` on the actual Linux host.
- Default resource layout: `/var/homelab-paas/<serviceId>/<resourceId>/...`.
- Bazel is the top-level build, test, code-generation, and image-packaging system. Use Bzlmod and pinned Rust and JavaScript toolchains.
- Use Cargo manifests/lockfiles for Rust dependency declarations and local Rust tooling. Keep pnpm manifests/lockfiles and all frontend-specific tooling under `services/paas-ui`; neither language tool owns the overall repository build.
- Use rustfmt, Clippy, and Rust's built-in test harness for Rust. Retain Vitest, oxfmt, and oxlint for frontend TypeScript, with GitHub Actions running the Bazel targets.

## Confirmed product decisions

1. Native Linux, one host and one K3s node. Availability guarantees apply to compatible application rollouts, not whole-appliance or host upgrades.
2. GitHub OAuth2 browser login with separate host-configured GitHub username lists for private applications and control-plane administrators. Every web resource defaults to `public: false`; only an explicit `public: true` bypasses the platform auth proxy. Management always requires administrator access. No local account database, bootstrap CLI, setup token, or special setup port.
3. A custom versioned YAML schema with service metadata and a resource map discriminated by each resource's `type` field.
4. Rust/Axum/Tokio backend, React/TypeScript/Vite frontend, shared Rust contracts, and Bazel workspace management. Maintained asynchronous OAuth2 and ACME libraries implement protocol mechanics; this project owns integration and lifecycle.
5. Reserved `_platform` state directory, configuration editable manually or through the UI, stable generated credentials, and data retention on descriptor deletion.
6. Primary web resource at `<serviceId>.<clusterDomain>`, additional web resources at `<resourceId>--<serviceId>.<clusterDomain>`, management at `paas.<clusterDomain>`. Services with multiple web resources must explicitly designate exactly one as primary.
7. DigitalOcean DNS-01 and a wildcard certificate initially.
8. Platform metrics cover every resource; application metrics require a supported endpoint/exporter. Pushgateway is for suitable short-lived jobs, not a replacement for worker scraping.
9. Bazel owns the build graph for both services and the final appliance image. The SPA is a JavaScript package, with no Cargo wrapper, frontend `build.rs`, or Rust image-packaging crate.
10. Require configured GitHub user/organization owners for repository discovery. Scan each repository's default branch and require separate approval for each root-level `.sd.yaml` descriptor; discovery alone never authorizes deployment.

The canonical platform directory is `_platform`. Users first edit `/var/homelab-paas/_platform/config.yaml` and its referenced secret file to configure domain, DigitalOcean/ACME credentials, GitHub OAuth2 credentials, private-application and administrator username lists, discovery owners, and repository read credentials. The appliance establishes HTTPS before offering GitHub login. Administrator-only onboarding presents discovered services for acceptance rather than requiring users to enter individual repositories manually. No unauthenticated bootstrap workflow is required.

## Product and trust boundaries

- Deliver one versioned outer Docker image and a systemd unit with the required mounts, privilege settings, port bindings, and shutdown behaviour.
- Workload containers run inside K3s' nested runtime. Do not use the host Docker socket to create sibling containers.
- Treat this as a trusted administrator's appliance. Network isolation between applications does not make it a hostile multi-tenant platform.
- Writers to an explicitly enrolled descriptor can change its deployed application through subsequent commits. Adding a configured discovery owner or finding a file does not grant deployment authority. Descriptor fields cannot select arbitrary host paths, elevate privileges, or access platform secrets.
- Only the platform declares public ingress, authentication middleware, TLS configuration, and policy objects.
- Do not reimplement Kubernetes or build a general-purpose Kubernetes management console.
- Do not add Argo CD, per-service Helm charts, a full service mesh, a cloud secrets backend, or another operator without a concrete requirement and an architecture decision.
- Do not implement cryptography, OAuth2 protocol mechanics, or the ACME wire protocol from scratch. Use maintained libraries and test the platform-owned behaviour.
- Builds produce application images outside this platform. The PaaS pulls and runs OCI images; source builds and a hosted registry are outside the initial scope.
- Multi-host scheduling, host failover, automatic database major-version upgrades, and general raw Kubernetes manifest execution are outside the initial scope.

## Runtime and appliance lifecycle

- A small appliance entrypoint/supervisor starts K3s, handles signals, and bootstraps the packaged platform resources. Keep business logic in the control plane.
- Recommended placement: run the control plane as a singleton Kubernetes workload, with the SPA build served by that backend. Traefik uses its internal Service for forward authorization.
- Bundle/import the control-plane workload image into the nested runtime as part of the appliance build. Users should not need to manage a second installation artifact.
- Bootstrap must install enough resources for the control plane to start without depending on its Git reconciler, authentication provider, or certificate issuer.
- Install exactly one Traefik instance; choose either the K3s-packaged instance or a platform-managed installation and pin that choice in the appliance release.
- Polling, reconciliation, auth, and certificate tasks run inside the one control-plane service. Supporting observability and database components remain separate Kubernetes workloads.
- Persist K3s state separately from application data. Recreating the outer container with the same host mounts must recover the cluster and resource identities.
- Keep Kubernetes management ports private. Public HTTP traffic uses host ports 80 and 443.
- Document native Linux, kernel/cgroup, Docker, networking, filesystem ownership, disk-space, and privilege requirements. A privileged outer container is an intentional appliance requirement.
- Public reachability, router forwarding, wildcard DNS, DNS API credentials, and identity-provider registration remain user prerequisites. Publishing Docker ports alone cannot establish those external conditions.
- Pin appliance component versions and images; never use mutable `latest` tags for platform components.
- Publish a compatibility matrix and an explicit upgrade procedure. Back up required state before incompatible migrations. Do not promise safe downgrade after a state migration.
- systemd supervises the outer appliance. The appliance supervisor handles K3s; Kubernetes handles its workloads. Avoid competing restart ownership.

## Workspace and module structure

```text
/
  AGENTS.md
  MODULE.bazel
  MODULE.bazel.lock
  BUILD.bazel
  .bazelversion
  .bazelrc
  Cargo.toml                    # Rust members/dependencies; not repo orchestration
  Cargo.lock
  rust-toolchain.toml
  rustfmt.toml
  .github/workflows/
    ci.yml
    appliance.yml
  services/
    control-plane/
      BUILD.bazel
      Cargo.toml
      src/
        main.rs
        lib.rs
        app.rs
        config/                # host config, secrets, validation, atomic writes
        api/                   # management routes, authz, errors, status streams
        auth/                  # GitHub OAuth2, sessions, policies, forward auth
        certificates/          # ACME lifecycle, DNS provider, TLS publication
        gitops/                # discovery, approval, tracked revisions, ownership
          discovery/           # GitHub owner/repository scans and candidates
          enrollment/          # acceptance, source bindings, durable decisions
          tracking/            # enrolled-source polling and revision snapshots
        descriptors/           # parsing, reference resolution, normalization
        reconciliation/        # planner, queue, orchestration, status, inventory
        kubernetes/            # kube client/runtime, watches, apply, owned cleanup
        resources/             # type-specific plans and lifecycle operations
          web/
          worker/
          postgres/
          ferretdb/
          rabbitmq/
        networking/            # ingress, route registry, policies, bindings
        storage/               # path allocation, aliases, retention, permissions
        observability/         # stack config, discovery, exporters, dashboards
        persistence/           # durable controller metadata and migrations
        platform/              # bootstrap reconciliation and component versions
      tests/                   # Rust integration-test targets
        fixtures/
    paas-ui/
      BUILD.bazel
      package.json
      pnpm-lock.yaml
      tsconfig.json
      .oxfmtrc.json
      .oxlintrc.json
      index.html
      vite.config.ts
      vitest.config.ts
      tools/
        contracts/             # schema-to-TypeScript generation and JS tooling
      src/
        main.tsx
        app/
        features/
          onboarding/
          discovery/           # scan status, candidate preview, accept/ignore
          cluster/
          services/
          topology/
          settings/
        components/
        api/
        styles/
  packages/
    shared-contracts/
      BUILD.bazel
      Cargo.toml
      src/
        lib.rs
        descriptors/
        config/
        api/
        status/
        errors/
        bin/
          export_contracts.rs  # schema exporter used by Bazel code generation
  tools/
    build/                     # small shared Bazel macros when needed
  deploy/
    appliance/
      BUILD.bazel              # runtime image, outer appliance, load/push targets
      rootfs/                  # supervisor/configuration files staged into image
    systemd/                   # installation unit and documented overrides
    kubernetes/                # platform bootstrap manifests, not app manifests
  examples/
    config/
    services/
  tests/
    appliance/
      BUILD.bazel              # explicit privileged local acceptance target
  docs/
    architecture/
    adr/
    operations/
```

- This is a target structure; create directories when they contain real code. Do not scaffold empty abstractions or speculative packages.
- `shared-contracts` is a Rust crate owning serializable public models, validation rules, and exportable schemas. Use Serde tagged enums for resource discriminants and validate domain invariants explicitly.
- The backend depends on the shared Rust crate; the frontend consumes its generated schemas/TypeScript declarations through the Bazel graph. Generated browser contracts contain no secret values, filesystem logic, Kubernetes client, or backend-only implementation.
- Shared packages never depend on services. The UI never imports backend implementation files, and backend-only builds must not depend on frontend tooling.
- Keep normalization/planning as pure as practical. Put network, Kubernetes, disk, and process effects behind small explicit adapters.
- Resource modules implement a consistent lifecycle contract. Extract a package only after a real second consumer or a clear independently maintained boundary exists.
- A supporting component being configured by the control plane does not require a new Rust service or workspace package.

## Testing and release acceptance

Use Rust's built-in unit/integration test harness, including Tokio async test support, exposed as Bazel Rust test targets. Use Vitest for frontend tests through Bazel JavaScript targets. Test meaningful behaviour and failure recovery, not snapshots of implementation structure.

- Appliance acceptance tests: real privileged nested K3s on a Linux runner with the production mount/port topology. Mock Kubernetes tests are insufficient evidence for runtime isolation and host persistence.

- Test file-based TLS/auth bootstrap, authenticated onboarding, GitHub OAuth2 allow/deny, unauthorized-header spoofing, denied network connections, permitted dependencies, log delivery, pull metrics, Pushgateway cleanup, and persistent database restart.

The first usable release is accepted when a fresh documented Linux host can:

1. Start one systemd-managed appliance with the documented mounts and ports.
2. Load host TLS/GitHub OAuth2 settings, separate private-application and administrator username lists, discovery owners, and repository-read credentials; obtain HTTPS and verify each private route enforces its applicable list.
3. Discover root-level `.sd.yaml` files across configured user/organization repositories without deploying them, accept selected candidates, and then continuously deploy/update a web app, worker, PostgreSQL, FerretDB, and RabbitMQ from enrolled descriptors.
4. Route expected hostnames with valid TLS; verify private-by-default web resources, explicit public bypass, and administrator-only management.
5. Inject stable scoped dependency credentials and enforce declared network permissions.
6. Persist data under the documented host paths across application and appliance replacement.
7. Show discovery/candidate/enrollment status, topology, revisions, health, logs, metrics, and actionable scan/deployment failures in the UI.
8. Complete a supported web rollout without failed test requests and preserve old capacity during a failed rollout.
9. Keep the last accepted configuration running through Git/API/network/validation failures, avoid deploying unapproved discoveries, and retain data after descriptor removal.
10. Recover from an interrupted reconcile and demonstrate the documented backup/restore procedure.

## Reference documentation

- [K3s in Docker](https://docs.k3s.io/advanced#running-k3s-in-docker)
- [Tokio-compatible HTTP client](https://docs.rs/reqwest/latest/reqwest/)
- [tracing](https://docs.rs/tracing/latest/tracing/)

Library references are implementation candidates, not unreviewed version pins. Record concrete version/compatibility choices when bootstrapping the workspace.
