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
- One TypeScript control plane on Node 24 owns descriptor parsing, Git polling, reconciliation, the custom auth proxy, certificate lifecycle management, secrets provisioning, managed resources, observability configuration, and the management API.
- Fastify supplies HTTP routing and structured logging. Use asynchronous clients with cancellation and timeouts; move blocking disk and serialization work into dedicated workers.
- A React/TypeScript/Vite SPA supplies authenticated onboarding and cluster management. Fastify serves the API and the built SPA from the same runtime image.
- Shared JSON Schemas define the canonical public data model and validation boundary; generate TypeScript contracts in the shared workspace package and validate untrusted inputs with Ajv.
- GitHub OAuth2 supplies browser login. Initial TLS/OAuth2 settings, allowed GitHub usernames, and GitHub discovery owners must be explicitly configured in the host file before web onboarding is available.
- Use GitHub APIs to enumerate repositories owned by configured users/organizations and discover root-level `*.sd.yaml` files. Discovery is read-only; explicit user acceptance enrolls a descriptor for ongoing deployment.
- Deploy through Git polling only. Do not implement Git webhooks.
- Implement the auth proxy and certificate manager inside this project rather than deploying OAuth2 Proxy, cert-manager, or Certbot.
- Use files on the host for configuration and secrets. No cloud secret manager is required.
- Default persistent root: `/var/homelab-paas` on the actual Linux host.
- Default resource layout: `/var/homelab-paas/<serviceId>/<resourceId>/...`.
- Controller metadata uses one versioned atomic YAML snapshot at `_platform/state/controller.yaml`, protected by a lifetime OS file lock at `_platform/state/controller.lock`. No controller database server or SQLite store; host configuration and secrets remain separate authoritative files. See [configuration and storage](configuration-and-storage.md) for commit, migration, singleton, and recovery requirements.
- Allocate one Kubernetes namespace per enrolled service, with separate reserved platform and observability namespaces. Use durable local inventory and owned-field reconciliation, without CRDs. Ordinary removal retains service namespaces, persistent data, and stable credentials. See [reconciliation](reconciliation.md) for ownership and cleanup rules.
- pnpm is the top-level build, test, contract-generation, and explicit image-packaging entry point. Use one workspace and committed root lockfile with pinned Node 24, TypeScript, and pnpm versions.
- Keep package manifests in their workspace packages and repository scripts/tooling at the root. Frontend-specific Vite/Vitest configuration remains in `services/paas-ui`.
- Use Vitest across backend, shared-contract, and frontend packages; use Oxc's oxfmt and oxlint across the workspace. GitHub Actions runs the same pnpm commands used locally.

## Confirmed product decisions

1. Native Linux, one host and one K3s node. Availability guarantees apply to compatible application rollouts, not whole-appliance or host upgrades.
2. GitHub OAuth2 browser login with separate host-configured GitHub username lists for private applications and control-plane administrators. Every web resource defaults to `public: false`; only an explicit `public: true` bypasses the platform auth proxy. Management always requires administrator access. No local account database, bootstrap CLI, setup token, or special setup port.
3. A custom versioned YAML schema with service metadata and a resource map discriminated by each resource's `type` field.
4. TypeScript/Node 24/Fastify backend, React/TypeScript/Vite frontend, shared schema contracts, and pnpm workspace management. Maintained asynchronous OAuth2 and ACME libraries implement protocol mechanics; select additional packages with owner approval.
5. Reserved `_platform` state directory, configuration editable manually or through the UI, stable generated credentials, and data retention on descriptor deletion.
6. Primary web resource at `<serviceId>.<clusterDomain>`, additional web resources at `<resourceId>--<serviceId>.<clusterDomain>`, management at `paas.<clusterDomain>`. Services with multiple web resources must explicitly designate exactly one as primary.
7. DigitalOcean DNS-01 and a wildcard certificate initially.
8. Platform metrics cover every resource; application metrics require a supported endpoint/exporter. Pushgateway is for suitable short-lived jobs, not a replacement for worker scraping.
9. pnpm owns orchestration for both services and explicit Docker Buildx packaging commands. Package compiled JavaScript, production dependencies, Node 24, and the SPA into one control-plane workload image.
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

### Local development milestone

Use Docker Desktop (macOS) and k3d for a reusable single-server local K3s cluster. The MVP deploys only the control-plane workload image, containing the Fastify healthcheck and hello-world React SPA. Bind its HTTP and Kubernetes API ports to loopback. k3d is development infrastructure, not the production outer appliance supervisor. Repeated deployments reuse the cluster and import content-tagged images without requiring a registry. See [local setup and commands](../README.md).

The MVP has no management functionality or authentication. The public health endpoint and hello-world shell do not enable unauthenticated management bootstrap. Shared schemas already supply strict API errors and generated types; the MVP health response has no body. Host-configuration and persistence libraries exist, while their startup/effect integration remains CP-06.

### Production appliance (not yet implemented)

- A small appliance entrypoint/supervisor starts K3s, handles signals, and bootstraps the packaged platform resources. Keep business logic in the control plane.
- Recommended placement: run the control plane as a singleton Kubernetes workload, with the SPA build served by that backend. Traefik uses its internal Service for forward authorization.
- All controller instances and maintenance tools must share the canonical host state directory and acquire its lifetime lock before recovery, migration, or effects. Stop the old controller and drain its workers/commits before releasing the lock and starting a replacement; replica count alone is insufficient. Controller overlap during upgrades is not supported.
- Bundle/import the control-plane workload image into the nested runtime as part of the appliance build. Users should not need to manage a second installation artifact.
- Bootstrap must install enough resources for the control plane to start without depending on its Git reconciler, authentication provider, or certificate issuer.
- Bootstrap must persist and explicitly hand off ownership of its initial platform objects, mount the same state directory for every controller, and establish the installation/cluster binding. Reconciliation cannot silently adopt bootstrap objects by name or label. Initialize metadata only for a verified fresh installation; missing state on an existing or ambiguous installation requires operator recovery.
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
  package.json                 # repository scripts and toolchain pins
  pnpm-workspace.yaml
  pnpm-lock.yaml               # one dependency lock for every package
  .node-version
  tsconfig.json
  .oxfmtrc.json
  .oxlintrc.json
  .github/workflows/ci.yml
  services/
    control-plane/
      package.json
      tsconfig.json
      tsconfig.build.json
      src/
        main.ts                # process signals, fatal boundary, exit status
        start.ts               # configuration, composition, startup
        frontend/
          frontend-router.ts   # Fastify API/static response mapping
          frontend-service.ts  # UI content selection
          frontend-store.ts    # UI filesystem inspection
        controller/
          controller-policy.ts # metadata and transition invariants
          controller-codec.ts  # bounded YAML/schema conversion
          controller-store.ts  # bounded worker-backed metadata store
          controller-writer.ts # atomic commits and migrations
          controller-worker.ts # lifetime lock and disk/serialization worker
          thread-channel.ts
        util/                  # config, host files, lifecycle, logging, POSIX, YAML
        # Tests live beside their modules.
    paas-ui/
      package.json
      tsconfig.json
      index.html
      vite.config.ts
      vitest.config.ts
      src/
  packages/
    shared-contracts/
      package.json
      src/
        schemas.ts             # canonical public wire schemas
        index.ts               # validators and generated type exports
        descriptor.ts          # CP-05 draft; parsing remains disabled
        generated/             # ignored generated declarations
      tools/generate.mjs
      tests/
  scripts/                     # explicit setup, packaging, local deployment
  deploy/
    appliance/Dockerfile       # inner workload; outer appliance is future
    appliance/bundle_test.py
    kubernetes/local.yaml
  docs/
```

- Create additional config, API, auth, certificate, GitOps, reconciliation, Kubernetes, resource, network, storage, and observability modules when they contain real implementation. Do not scaffold empty abstractions.
- Shared contracts own public JSON Schemas, generated TypeScript types, and runtime validation. Use discriminated resource unions and validate domain invariants explicitly.
- Both services import the shared workspace package. Public contracts contain no resolved secrets, filesystem logic, Kubernetes clients, or backend adapters. Shared packages never depend on services; the UI never imports backend implementation files.
- Backend builds depend on shared generation but require no frontend tooling or bundle. Keep normalization/planning pure; put effects behind small explicit adapters.
- Resource modules implement a consistent lifecycle contract. Extract another package only for a real second consumer or independently maintained boundary. A supporting workload does not require another control-plane service.

## Testing and release acceptance

Use Vitest for backend, shared-contract, and frontend tests through the pnpm workspace. Test meaningful behaviour and failure recovery, not snapshots of implementation structure.

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
- [Node fetch](https://nodejs.org/docs/latest-v24.x/api/globals.html#fetch)
- [Fastify logging](https://fastify.dev/docs/latest/Reference/Logging/)

Library references are implementation candidates, not unreviewed version pins. Record concrete version/compatibility choices when bootstrapping the workspace.
