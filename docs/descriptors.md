# Service descriptor contracts

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing descriptor parsing, validation, defaults, resource profiles, bindings, or shared contracts.

Read related requirements only when the change crosses those boundaries: [GitOps](gitops.md), [reconciliation](reconciliation.md), [configuration and storage](configuration-and-storage.md), [access and ingress](access-and-ingress.md).

## Service descriptor contract

- Descriptors express platform intent, not Kubernetes object structure.
- Each enrolled service receives one platform-allocated namespace; descriptors cannot select namespaces or define CRDs. Reserve the `homelab-paas.io/` metadata prefix for platform ownership; descriptor labels cannot override it. Labels never confer ownership of existing objects.
- Discoverable service descriptors are regular files at the repository root with a filename ending exactly in `.sd.yaml`, such as `media.sd.yaml` or `app.sd.yaml`. Do not recursively search subdirectories, follow symlinks/submodules, or deploy other YAML files by convention.
- YAML documents have top-level `version`, `metadata`, and `resources` fields. `metadata.serviceId` is required; metadata also supports a display name, description, and string labels.
- One file identifies a service by stable `metadata.serviceId` and contains a resource map keyed by stable `resourceId`. Every resource requires a literal `type` field that selects its discriminated schema.
- One service can contain multiple web resources, workers, and managed dependencies.
- With no web resources, no primary route is created. A sole web resource is implicitly primary. With multiple web resources, exactly one must declare `primary: true`; missing or multiple primary selections are validation errors. Only web resources may declare `primary`.
- Every web resource has a boolean `public` field defaulting to `false` when omitted. `public: false` requires GitHub login and membership in `auth.github.allowedUsernames`; `public: true` configures Traefik to bypass the platform auth proxy for that web resource. Reject non-boolean values and `public` on non-web resources.
- Private web resources still have their generated HTTPS route; `public` controls platform authentication, not whether ingress exists. This flag never changes internal service-to-service network permissions or makes the management UI public.
- Require an explicit schema version. Reject unknown versions, unknown fields, duplicate IDs, unresolved references, and invalid combinations with file/field diagnostics.
- Keep defaults centralized in the schema/planning layer. Document defaults and expose the resolved configuration for inspection.
- A service's identity is independent of its repository path. Moving a descriptor must not implicitly destroy its data.
- Renaming a service/resource is a migration to a new identity, not an automatic directory rename.
- Use immutable image digests for reproducible deployments; support explicit tags if needed, but resolve and record the deployed digest.
- Support explicit environment variables, secret references, config files, command/arguments, ports, resource requests/limits, startup/readiness/liveness probes, replica counts, shutdown grace, storage, and deployment strategy.
- Web resources also declare exposure/auth policy, primary route selection, ingress timeouts, request-size limits, and relevant streaming/WebSocket settings.
- Workers have no public ingress by default and declare shutdown/concurrency behaviour where overlap matters.
- Typed dependency bindings declare the target resource, required permission, credential scope, and environment-variable mapping.
- Do not guess that arbitrary images consume `DATABASE_URL`. Supply standard mappings for supported resource profiles and permit explicit env-var names.
- Secrets appear only as references in Git descriptors. API previews and rendered plans redact resolved values.
- Provide validation and plan output before mutation. The same parser and contract govern Git ingestion, APIs, and UI diagnostics.
- New schema versions require documented compatibility/migration rules and fixtures. Avoid untyped arbitrary Kubernetes escape hatches.

Initial resource catalog:

| Type | Platform responsibilities |
| --- | --- |
| `web` | Container workload, internal Service, health, HTTP route, TLS/auth policy, logs, metrics, optional storage |
| `worker` | Container workload, health, lifecycle, dependency bindings, logs, metrics, optional storage |
| `postgres` | Pinned supported image/version, persistent data, health, scoped credentials, connection bindings, exporter, backup/restore procedure |
| `ferretdb` | Supported FerretDB/backend combination, required PostgreSQL/DocumentDB components, persistence, credentials, bindings, health, monitoring |
| `rabbitmq` | Persistent broker, scoped users/vhosts/permissions, bindings, health, monitoring; management ingress private and opt-in |

Managed-resource support includes initialization, stable credentials, health reporting, data retention, and documented version upgrades. It does not imply high availability or zero-downtime upgrades.

Descriptor shape:

```yaml
version: 1
metadata:
  serviceId: example
  name: Example application
  description: A web application and its database
  labels:
    owner: homelab
resources:
  app:
    type: web
    public: false
    image: ghcr.io/example/app:1.0.0
    port: 3000
  db:
    type: postgres
```

This shows the document structure; resource defaults, bindings, and supported version fields are defined by the shared schemas. Here `app` is the only web resource, so its primary route is implicit. Its explicit `public: false` is equivalent to omitting `public`.

## Required verification

- Unit/contract tests: descriptor validation/defaults, bindings, permissions, hostname/path validation, plan generation, secret redaction, username matching, discovery-owner configuration, candidate identity, approval state, and revision transitions.
