# CP-05 — Proposed version-1 descriptor decisions

Status: **draft for owner approval; not accepted product policy**. No dependent implementation is authorized until the owner approves or corrects these decisions.

This revised proposal incorporates the owner's requested simpler homelab scope. It fills the concrete-schema gaps identified by [CP-05](CP-05-web-worker-descriptors.md). On approval, update the [descriptor](../../descriptors.md) and [reconciliation](../../reconciliation.md) guides to record the explicitly deferred capabilities below; other existing requirements remain binding.

## Decisions requiring particular attention

The following are **new proposed restrictions/defaults**, not existing requirements:

- Require a fully qualified image with an explicit tag or digest; reject `latest` and untagged images.
- Use a 4096 MiB (4 GiB) default memory limit, interpreting the owner's "4gb" request in the schema's MiB units.
- Run both web and worker resources as one replica with recreate deployment. No horizontal scaling, HPA, rolling strategy, or replica configuration in this version.
- Expose one `healthcheck`, with an automatic HTTP `/` check for web resources. Do not expose separate readiness, startup, or liveness fields.
- Expose only one top-level web `port`. Omit descriptor ingress settings, bindings, network permissions, and extra port declarations entirely.
- Keep runtime rollout deadlines and bounded controller operation concurrency internal. Do not expose `progressDeadlineSeconds`, application `concurrency`, or `overlap`. The platform does not control internal application threads or job concurrency.
- Adopt the concrete bounds below. They are deliberately finite; the owner may choose different values before implementation.

## 1. Document, identities, and routes

Use one strict YAML document with camelCase fields:

```yaml
version: 1
metadata:
  serviceId: example
  name: Example # optional
  description: Example app # optional
  labels: {} # default
resources:
  app:
    type: web
    image: ghcr.io/example/app:1.0.0
    port: 3000
```

- Require integer `version: 1`; reject other versions, unknown fields, duplicate mapping keys, merge keys, aliases, and additional documents.
- Require 1–64 resources; support only literal `type: web` and `type: worker`. Managed-resource types produce an explicit unsupported-resource-type diagnostic until implemented.
- Service, resource, and volume IDs use lowercase DNS labels of 1–30 ASCII characters, beginning/ending with a letter or digit, with single internal hyphens; reject `--`. Reject invalid input rather than silently rewriting identities.
- Reserve service IDs `paas`, `platform`, and `observability`; underscore-prefixed identities, including `_platform`, are invalid. Descriptor labels cannot use the reserved `homelab-paas.io/` prefix.
- Preserve the binding primary rules: no web resources means no route; a sole web resource is implicitly primary; multiple web resources require exactly one explicit `primary: true`. Reject `primary` and `public` on workers. Web `public` defaults to `false` and accepts booleans only.
- Generate the primary host as `<serviceId>.<clusterDomain>` and others as `<resourceId>--<serviceId>.<clusterDomain>`. Validate DNS labels at most 63 bytes and complete hostnames at most 253 bytes, plus collisions with supplied existing route reservations.
- Route only `/`; do not accept custom hostnames, path prefixes, or auth exceptions. Validate supplied identity/path reservations before any allocation.

## 2. Common workload fields

| Field             | Shape and default                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image`           | Required string: explicit fully qualified registry/repository and tag or `sha256` digest; reject credentials, `latest`, and untagged images. Tags are accepted intent; later deployment resolves and records the digest. |
| `command`, `args` | String arrays; default `[]`.                                                                                                                                                                                             |
| `env`             | Map of environment-variable name to exactly one of `{value: string}` or `{secretRef: name}`; default `{}`. Names use `[A-Za-z_][A-Za-z0-9_]*`.                                                                           |
| `configFiles`     | Map of normalized absolute container file path to exactly one of `{content: string}` or `{secretRef: name}`; default `{}`.                                                                                               |
| `requests`        | `{cpuMillis: 100, memoryMiB: 128}` by default; omitted members also receive these defaults.                                                                                                                              |
| `limits`          | `{cpuMillis: 1000, memoryMiB: 4096}` by default; omitted members also receive these defaults.                                                                                                                            |

CPU values are integers in 1–64000; memory values are integers in 1–262144 MiB. Each request must not exceed its limit. Web resources additionally require integer `port` in 1–65535, representing their sole TCP HTTP endpoint. Workers reject `port`. No `ports` or `replicas` fields are accepted.

Literal environment/config content is explicitly **non-secret** intent. Sensitive values must use references. Reject inline secret fields structurally, but do not claim that validation can prove arbitrary literal text contains no credential. Preview redacts literal environment values and file content as well as resolved secrets.

## 3. Lifecycle

| Field                  | Shape and default                 |
| ---------------------- | --------------------------------- |
| `shutdownGraceSeconds` | Integer, default 30, range 1–300. |

Both resource types resolve to fixed one-replica recreate deployment, including those with writable storage. Preview shows expected interruption. `strategy`, `replicas`, `progressDeadlineSeconds`, `concurrency`, and `overlap` are rejected unknown descriptor fields. The later runtime/reconciler owns bounded deadlines and operation concurrency; CP-05 does not implement a job scheduler or control application-internal concurrency. Automatic rollback behavior is **deferred to CP-23**. No arbitrary migration execution is introduced.

## 4. One healthcheck

One optional `healthcheck` uses discriminated shapes:

```yaml
healthcheck:
  type: http # http | tcp | exec
  path: /
  initialDelaySeconds: 0
  periodSeconds: 10
  timeoutSeconds: 1
  failureThreshold: 3
```

- HTTP requires `path`; TCP has no extra endpoint fields; both use the resource's top-level web port and are web-only. Exec requires a nonempty `command` string array and is available to web resources and workers. Reject fields belonging to another variant.
- Defaults/ranges: initial delay 0 (0–300), period 10 (1–300), timeout 1 (1–60 and no greater than period), failure threshold 3 (1–60).
- HTTP paths are absolute; reject traversal, query, and fragment. HTTP uses GET and has no configurable headers or alternate port.
- Omitted web healthcheck resolves to HTTP GET `/` on the required web port with the defaults above. Omitted worker healthcheck means process-only health; preview states that this does not prove job completion. The single declared check is the source of readiness/health intent; deployment probe translation remains the runtime's implementation concern.
- Reject `startupProbe`, `readinessProbe`, and `livenessProbe` fields.

## 5. Web ingress scope

No descriptor ingress settings in this version. Reject `ingress`, custom timeout/body-size options, streaming/WebSocket configuration, hosts, and paths. The platform owns generated HTTPS routes and authentication, preserving private-by-default `public` behavior. Ingress tuning is explicitly deferred; no indefinite-stream availability promise is added.

## 6. Storage and file paths

`storage` is a map from volume ID to a discriminated declaration:

```yaml
storage:
  cache:
    type: ephemeral
    mountPath: /app/cache
    readOnly: false
  data:
    type: data
    mountPath: /app/data
    readOnly: false
  assets:
    type: persistent
    mountPath: /app/assets
    readOnly: false
  media:
    type: alias
    alias: media-library
    mountPath: /media
    readOnly: true
```

- `readOnly` defaults to false except for alias mounts, where it defaults to true. Alias write access requires explicit caller-provided authorization.
- `data` denotes the resource's retained `data/` directory, with at most one declaration per resource. `persistent` denotes retained `volumes/<volumeId>/`. `ephemeral` has no retained path. Alias names resolve through an explicitly supplied authorized alias catalog.
- Container paths must be absolute and already normalized. Reject traversal, backslashes, `/`, `/proc`, `/sys`, `/dev` and their descendants, platform/host paths, and overlapping file/mount destinations. Descriptors never supply host paths.
- Parsing, normalization, reference checking, and preview neither allocate directories nor inspect/create the filesystem.

## 7. Bindings and network permissions are deferred

Reject `bindings`, `permissions`, and additional `ports` fields. No resource connections, credential scopes, environment mappings, or Internet-access policy are configurable in CP-05. This does not introduce broad network access: existing default-deny network-policy requirements remain binding, with routing/DNS/platform infrastructure grants owned by the later planner. Managed-resource bindings and network policy configuration are deferred until explicitly scoped and designed. Secret and alias references remain validated as described below.

## 8. Bounds, previews, references, and compatibility

| Item                                        | Proposed limit                      |
| ------------------------------------------- | ----------------------------------- |
| Encoded YAML                                | 256 KiB                             |
| Nesting depth                               | 32                                  |
| Resources                                   | 64                                  |
| Environment entries, mounts, files          | 64 each per resource                |
| Command/argument/exec-command entries       | 32 each                             |
| Individual string                           | 4096 UTF-8 bytes                    |
| Aggregate inline config/environment content | 64 KiB per descriptor               |
| Metadata labels                             | 32; key/value at most 63 bytes each |

Normalization produces a deterministic sorted representation with explicit resolved defaults and primary selection. Field diagnostics contain file/field paths and stable error codes, with parser line/column where available, and omit rejected values/parser excerpts.

A pure caller-provided validation context supplies the cluster domain, occupied hosts/identity/path reservations, permitted application-secret references, and permitted aliases. Secret/alias grants are resource-scoped. Unknown or unauthorized references fail. The context must exclude platform credentials; a descriptor cannot acquire permission by naming a platform secret. Reference names follow the existing host credential-name grammar separately from the shared nonempty `CredentialReference` primitive. Preview never resolves secret values or performs provisioning, secret generation, directory allocation, network calls, or host I/O.

Canonical normalized `Descriptor` implements the CP-04 `DesiredState` contract, revalidating structural secret restrictions, bounds, canonical defaults, and internal references before persistence. External authorization remains checked against the caller's validation context before acceptance; no context grants are fabricated during recovery.

Unknown versions and fields fail closed. Future additive version-1 schema changes require documented compatibility rules and fixtures; breaking field/default changes require version 2 and explicit migration rules. No implicit descriptor migrations or Kubernetes escape hatches.

## Approval record

Pending owner approval. Record the explicit approved decisions and any corrections before implementing dependent behavior, then incorporate the accepted contract into the binding guide and fixtures.
