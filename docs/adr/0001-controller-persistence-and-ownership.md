# ADR 0001 — Controller persistence and Kubernetes ownership

Date: 2026-10-18 · Status: Accepted by owner

Ticket: [CP-01](../project/m1/CP-01-persistence-and-ownership-adr.md).

## Decision status and boundaries

The owner approved file-based storage under `/var/homelab-paas/_platform`, one atomic YAML metadata snapshot, a lifetime file lock, one namespace per service, and no CRDs. The protocols and ownership rules below are accepted. Operative requirements are incorporated into the platform, configuration/storage, GitOps, descriptor, and reconciliation guides; this ADR preserves the rationale and alternatives rather than serving as a required implementation reference.

Binding requirements come from [platform architecture](../platform-spec.md), [configuration and storage](../configuration-and-storage.md), [GitOps](../gitops.md), and [reconciliation](../reconciliation.md): one controller, no additional database server, durable enrollment before deployment, restart-safe identity, no silent resource adoption, and retention of data and credentials on ordinary removal.

## Authoritative owners

| Information | Authority | Local representation and recovery |
| --- | --- | --- |
| Cluster/bootstrap/access/discovery settings | Administrator's host `_platform/config.yaml` | UI writes this same file atomically; the controller store contains no competing configuration copy. Reload semantics remain a separate decision. |
| User-supplied secrets | Referenced host secret files, initially `_platform/secrets.yaml` | Metadata contains references only; never secret values. |
| Application desired state | Explicitly enrolled Git descriptor at an immutable revision | Persist the accepted normalized snapshot and revision/digest for restart recovery. It is a materialized Git version, never a UI override. Retain the last valid snapshot on source failure. |
| Candidates, ignores, enrollment, approval audit, pinned source, stop/rebind decisions | Local controller metadata | Durable records under `_platform/state`; discovery and Kubernetes cannot manufacture enrollment. |
| Installation/service/resource identities, reservations, inventory, operation progress | Local controller metadata | Stable identities and pending intents precede external effects. Kubernetes labels are corroborating evidence, not a replacement for this store. |
| Live objects, UIDs, resource versions, conditions | Kubernetes API | Cached observations are replaceable and refreshed after restart. Desired/applied/healthy revisions remain distinct. |
| Generated resource credentials | Stable resource `secrets/` files | Controller stores references and materialization progress. Existing files survive restart/removal; Kubernetes Secrets are scoped copies. |
| Application data and declared volumes | Host resource directories or configured aliases | Inventory tracks identity/retention, not contents. Ordinary cleanup cannot erase them. |
| ACME/certificate material; K3s state | Their specified `_platform/certificates/` and `_platform/k3s/` stores | Separate lifecycle and backup boundaries; not folded into controller metadata. |

## Storage alternatives

| Option | Benefits | Costs and disposition |
| --- | --- | --- |
| One versioned metadata snapshot file | Inspectable, no database runtime; one replacement commits related records together | Rewrites the snapshot per commit; bounded metadata only. Selected. |
| Independent YAML/JSON record files | Small writes and convenient inspection | Renaming multiple files is not one transaction; approval, reservations, and inventory can diverge after a crash. Would require a journal or generation manifest. Not recommended initially. |
| Append-only file journal plus snapshots | Small durable appends; historical replay | Requires torn-tail handling, replay, compaction, and format evolution. Defer until measured write volume justifies it. |
| Embedded transactional database, such as SQLite | Existing transaction/recovery machinery and indexed queries | Owner explicitly chose files instead. Not selected. |
| Kubernetes objects/CRDs as the metadata store | API persistence and watches | Couples controller recovery to cluster state and introduces another authority for approvals; does not replace host config/secrets. Not selected. |

## File layout and records

Use `_platform/state/controller.yaml` as the sole committed metadata snapshot and `_platform/state/controller.lock` as a stable lock inode. Temporary snapshots live in that same directory. Existing host configuration remains separate. Internal metadata is controller-written; manual repair requires stopping the controller and validating the repaired state before restart.

The snapshot envelope carries a store schema version, monotonically increasing commit generation, and stable installation ID. Typed records carry an explicit kind/version, stable identity, and record generation for stale-request detection. Reject duplicate keys, unknown/unsupported versions, malformed records, duplicate identities, and inconsistent references before publishing anything.

Persist candidates/decisions, enrollment audit and immutable source identity, accepted desired snapshots, revision transitions, operation IDs/intents/results, object inventory, retained storage/credential references, and service/route reservations. Use typed operation states, not arbitrary strings. Enrollment uniqueness uses repository ID, pinned branch, and root descriptor path; repository names are display metadata. Reserve service IDs/routes atomically with enrollment. Repeated requests resolve to the existing durable decision, including when a response was lost.

Keep raw Git repositories, logs, metrics, observed watch streams, and secret-bearing descriptor values out of this file. Store secret references only and reject inline credentials rather than persisting them. Bound snapshot size, record counts, parsing work, queues, and history; exhaustion rejects further mutations visibly instead of dropping enrollment, pending operations, or retained inventory. Exact limits and Rust serialization/library choices belong to CP-04 and the canonical contracts.

## Durable commit protocol

Serialize mutations through one bounded writer running disk/serialization work outside Tokio executor threads. Readers use the last committed immutable in-memory snapshot. A transaction checks expected generations, applies all related changes, validates the entire next snapshot, then:

1. Create a unique temporary file exclusively in the state directory, without following symlinks; use restrictive directory/file permissions (`0700`/`0600`) and validate containment/ownership. Never truncate the committed file.
2. Write the complete next snapshot, flush buffered output, and sync the file.
3. Atomically rename it over `controller.yaml` on the same filesystem.
4. Sync the state directory, then publish the in-memory snapshot and acknowledge success. Newly created state directories also require syncing their parent entries before first use.

This uses Linux [atomic replacement](https://man7.org/linux/man-pages/man2/rename.2.html) plus [file and directory synchronization](https://man7.org/linux/man-pages/man2/fsync.2.html). Require a local persistent filesystem with working rename, sync, and locking semantics, backed by the appliance host bind mount. Network filesystems and ephemeral container layers are unsupported for controller state.

A failure before rename leaves the old commit authoritative. A failure after rename but before directory sync has an uncertain durability outcome: stop further writes and external effects, report an indeterminate commit, and recover from the validated committed path on restart. Do not acknowledge success or keep mutating from an old in-memory generation. A lost response is resolved by operation identity, not by allocating another identity.

Startup acquires the lifetime lock before reading/recovering state. Only `controller.yaml` is authoritative; uncommitted temporary files are never promoted based on timestamps. Parse and validate it, then discard abandoned temporary snapshots. Missing/corrupt committed state on an existing installation is a recovery error, never permission to regenerate identities or reconstruct approvals from Kubernetes. Initial store creation is allowed only for a verified fresh installation without prior managed state; ambiguous cases require operator recovery. Recovery with a valid file resumes pending intents and refreshes Kubernetes observations before new effects.

## Singleton enforcement

Acquire an exclusive nonblocking OS file lock on `controller.lock` before initialization, migration, management mutation, or any background side effect. Keep its descriptor open for the process lifetime, with close-on-exec; never unlink or replace the lock file. All controller instances and offline migration/repair tools must use the same mounted directory and protocol. A contender exits with an actionable already-running error; it cannot offer a second management writer.

Linux [file locks](https://man7.org/linux/man-pages/man2/flock.2.html) are advisory and released when the final holding descriptor closes. A PID file or replica count alone cannot enforce this. Use a singleton workload with replacement sequencing that stops the old process before starting its successor. On shutdown, stop accepting mutations, cancel and await workers and disk commits, then release the lock. No worker may continue after release.

This deliberately sacrifices controller overlap during upgrades. It covers the specified one-host, shared-store appliance, not multiple independent state roots targeting one cluster. Record and verify installation/cluster binding before mutation; a mismatched binding fails closed. Bootstrap must supply the canonical shared state mount to every controller. A Kubernetes Lease could coordinate future replicas but adds expiry/fencing failure modes and is not recommended for this single-host scope.

## Migrations and recovery

Run ordered, explicit schema/record migrations under the lifetime lock before enabling management mutations or reconciliation. Reject newer schemas and unsupported older versions without rewriting them. Validate cross-record invariants and stable IDs after each transformation; migration must not regenerate identities, credentials, or accepted revisions.

Before migration, write and sync a restrictive, validated backup of the current committed snapshot and sync its directory. Transform in memory and commit the complete migrated snapshot through the same replacement protocol; never migrate individual records in place. A crash leaves an old or new complete file, identifiable by schema version. Migration/validation/disk failure stops startup without external effects. Do not silently restore an older backup after newer operations may have run.

Restore is an explicit stopped-controller procedure: recover metadata together with matching host config, secrets/certificates, K3s state, and resource-specific data backups, then verify cluster/installation identity and refresh observations. A metadata file alone is not a database backup. No safe downgrade after migration is promised. Backup scheduling, remote destinations, session persistence, and secret rotation remain out of scope.

## External-effect boundaries

There is no transaction across the filesystem, Kubernetes, and dependency APIs. Each effect therefore follows durable intent → bounded idempotent effect → durable observation/result:

1. Acceptance commits administrator identity/time, reviewed commit/digest, pinned source, stable service/resource IDs, reservations, accepted snapshot, and initial pending operation together. Only then enqueue deployment. Restart reschedules pending operations, so the in-memory queue is never the sole record of work.
2. Before creating an object/path/credential or calling a dependency API, commit its stable target identity, ownership token, desired generation, and pending intent. Use deterministic names and idempotency keys where supported; inspect uncertain outcomes before retrying.
3. Materialize generated credentials atomically without overwriting an existing credential. Sync the secret file and containing directory before using it externally. After a crash, validate and reuse the existing file; missing/corrupt credentials for an already provisioned resource block recovery instead of generating replacements.
4. Record returned Kubernetes UID/resource version and completion only after observing the effect. A failed result commit leaves a pending operation; restart inspects the same target instead of duplicating it. Applied and healthy revisions advance only on their respective verified conditions.
5. If any durable write fails, pause new external mutations. Effects already in flight may finish; their previously committed intents support inspection on restart. Never report an unrecorded operation as durably successful.

## Kubernetes ownership

Use one namespace per enrolled service, plus separate reserved platform and observability namespaces. Persist namespace allocation/name before creation and returned UID after observation; descriptors cannot select namespaces. Persist the naming algorithm/version and validate DNS limits/collisions before enrollment. One shared application namespace weakens service boundaries; one namespace per resource complicates bindings without a current requirement. Keep service namespaces on ordinary removal, avoiding namespace deletion's broad cascade.

Platform objects carry a reserved `homelab-paas.io/` metadata prefix: installation, service, resource (where applicable), and object ownership IDs; desired revision/generation are diagnostics. Source IDs and complete identity remain in inventory. Labels are selectors/evidence, never sufficient authorization to adopt or delete an object.

Inventory identifies the target cluster, API group/resource, namespace/name, expected kind/version, returned UID, enrollment/service/resource identity, stable object token, desired generation, field manager, and lifecycle class (`runtime` or `retained`). Namespace inventory has no namespace; cluster-scoped objects require explicit platform inventory. Pending creates have target identity/token but no UID yet. Do not invent UIDs or treat names alone as ownership.

Create absent objects with a create request carrying the persisted token. If a name already exists, reject it unless it matches recorded UID/ownership; recovery of an interrupted create may bind the observed UID only when the durable create intent and exact ownership token match. A racing foreign create remains a conflict. Do not use apply to adopt an unknown object. The appliance bootstrap contract must explicitly persist/handoff ownership of its initial platform objects; ordinary reconciliation cannot claim pre-existing resources by convention.

Update verified owned objects with [server-side apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) using a stable platform field manager and `force: false`. Apply only generated specification and reserved metadata fields; leave status, allocated fields, and other managers' fields alone. Ownership/field conflicts stop the affected operation with target/field diagnostics. Manual edits to platform-owned intent are surfaced rather than silently overwritten; unrelated non-owned fields remain intact. Concurrent replacement detected during an update is a conflict requiring re-observation, not adoption.

Use Kubernetes [owner references](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) only inside disposable runtime hierarchies, such as Deployment → ReplicaSet → Pod. Never link retained data/credential objects to disposable runtime owners, and never tie service lifetime to the controller Pod. Do not introduce CRDs or custom-resource finalizers: the local store holds controller intent and finalization progress. Any future CRD use requires a new architecture decision for a concrete requirement; Git remains application authority.

## Removal and retained cleanup

Only explicit authorized removal or descriptor absence in a complete successfully fetched enrolled revision starts runtime pruning. Discovery omissions, source errors, partial scans, and invalid desired state do not authorize deletion.

Commit a deletion intent listing exact inventory targets before effects. For each runtime object, verify current ownership and delete with UID/resource-version preconditions; a changed UID, metadata mismatch, or unexpected dependent is a conflict. Record observed absence before completing its inventory transition. Timeout/lost responses leave the same deletion pending for inspection, never a broader selector-based delete.

Retained entries, resource directories, credential files, aliases, and persistent volumes/claims are excluded from ordinary deletion. Provision any PV with an explicit `Retain` reclaim policy; avoid owner references or storage provisioning paths that can cascade into data loss. Keep retention tombstones and identity/path reservations so a different source cannot silently acquire retained state. Never recursively remove the service namespace or host resource root during ordinary cleanup. Unrecognized dependencies block potentially cascading deletion until diagnosed.

Destructive purge remains CP-41: a separate administrator-authorized operation targeting exact retained identities, with active-resource protection and durable progress. This ADR does not decide re-enrollment/reuse policy or authorize purge.

## Scenario review and implementation verification

The following is a design walkthrough, not evidence of implemented fault-injection tests. CP-04 implements the file/lock/migration cases; CP-18/CP-20/CP-22/CP-26 and CP-41 verify their effect boundaries.

| Scenario reviewed | Required outcome |
| --- | --- |
| Crash during temporary write/file sync | Old committed snapshot remains authoritative; no effect follows an uncommitted intent. |
| Crash after rename, before directory sync | Startup validates whichever complete committed generation survived; no automatic temporary-file promotion. Sync failure stops further effects. |
| Enrollment commit succeeds, enqueue/response is lost | Restart discovers pending deployment; retry returns the same enrollment and IDs. |
| Create succeeds, result commit is lost | Inspect deterministic target/token; record its UID and resume, without duplicate object or credentials. |
| Credential file sync succeeds, controller crashes | Reuse the same valid credential before provisioning; corruption/missing provisioned credentials stops recovery. |
| Two controllers or a migration tool start together | Only the shared lock holder can write or perform effects. No stale-PID takeover. |
| Migration crashes, fails validation, or runs out of disk | Valid old/new version is selected by committed path; no partial migrations or background mutation. Newer versions are rejected. |
| Snapshot corrupt, missing on existing install, or mounted to wrong cluster | Fail closed; operator restores matching state. No regenerated approvals/installation identity. |
| Foreign namespace/object, conflicting fields, or UID replacement | Report conflict; no forced apply, silent adoption, or deletion of replacement objects. |
| Removal interrupted or namespace contains unrelated objects | Resume exact pending runtime deletions; retain namespace, data, credentials, and tombstones. |
| Source unreachable/partial scan; descriptor truly deleted | First case retains deployment; only complete enrolled-source evidence permits runtime pruning in the second. |
| Disk full/unwritable or commit response uncertain | Typed actionable persistence error; pause effects, preserve committed identity, resolve retries using operation IDs. |

Consequences: whole-snapshot writes keep the initial file store understandable, at a cost in write amplification and bounded metadata capacity. The lock requires shared host mounts and controller downtime during replacement. Conservative conflicts and retained namespaces require operator diagnosis rather than automatic adoption. These tradeoffs are accepted; exact limits, library choices, and explicitly out-of-scope product policies remain with their implementation tickets.
