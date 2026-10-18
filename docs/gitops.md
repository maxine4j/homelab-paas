# GitHub discovery, enrollment, and tracking

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read when changing discovery, approvals, tracked sources, polling, or source ownership.

Read related requirements only when the change crosses those boundaries: [descriptors](descriptors.md), [configuration and storage](configuration-and-storage.md), [access and ingress](access-and-ingress.md), [reconciliation](reconciliation.md).

## GitHub discovery, enrollment, and GitOps polling

Discovery finds possible services. Enrollment records the user's deployment decision. Tracking continuously reconciles only enrolled descriptors. Keep these operations and their state distinct.

### Repository and descriptor discovery

- Periodically enumerate repositories owned by every configured GitHub user/organization using GitHub APIs, including all pagination. Do not depend on GitHub code search or cloning/executing every repository for discovery.
- Inspect all public/private repositories readable by the configured credentials and owned by the configured owner. Do not expand scope to unrelated collaborator repositories, organization members' personal repositories, or other owners merely because a token can read them.
- Use appropriate authenticated enumeration for private personal repositories and filter by owner; the public user-repositories endpoint alone cannot provide private-repository coverage. Organization enumeration and content access must also use sufficient repository-read permissions.
- A scan can only see repositories its credentials can access. Report authorization errors and incomplete/truncated scans; do not claim visibility over inaccessible private repositories or interpret a partial result as deletion.
- Discovery scans each repository's current default branch. Resolve its head to an immutable commit, enumerate that commit's root tree without recursion, and inspect only regular root-level files ending in `.sd.yaml`.
- Fetch candidate contents at that same immutable commit/blob revision. Bound file size and parsing work; never run repository code or resolve arbitrary descriptor includes during discovery.
- Empty repositories, missing default branches, unreadable files, and invalid descriptors appear as scoped discovery diagnostics. One repository/file failure must not hide other discovered candidates.
- Parse candidates using the same versioned Rust descriptor contracts as tracking. Show invalid matching files with validation diagnostics; they cannot be accepted for deployment until valid.
- Record repository identity, owner/name, branch, descriptor path, commit/blob revision, service metadata, resource summary, discovery timestamps, and validation status. Use immutable GitHub repository IDs for identity rather than only mutable names/URLs.
- Deduplicate overlapping scans. Mark forks/archived repositories in the UI rather than silently ignoring repositories that otherwise meet discovery scope.
- Recommended discovery polling interval: five minutes, with jitter, bounded concurrency, conditional requests/caching, rate-limit handling, and retry backoff. Allow an authenticated administrator to request a rescan.

### Acceptance and tracked-source lifecycle

- The enrollment unit is one descriptor: repository ID, default-branch name at acceptance, and root filename. A repository with multiple matching files produces separate candidates requiring separate acceptance.
- Before acceptance, show the exact reviewed descriptor revision, service ID, resources, routes, storage, and requested permissions. Discovery/preview must not launch workloads, allocate application data directories, or provision dependency secrets.
- Acceptance is an authenticated, administrator-only API operation. Validate the reviewed candidate again, detect service-ID/route/ownership conflicts, and reject stale approval requests when the reviewed descriptor has changed; refresh the preview instead of silently approving different contents.
- Commit enrollment, approving GitHub user identity/time, pinned branch/path, reviewed commit/digest, accepted normalized snapshot, stable service/resource IDs, service/route reservations, and the initial pending operation together in `_platform/state/controller.yaml` before enqueuing deployment. Use the atomic snapshot/lifetime lock protocol in [configuration and storage](configuration-and-storage.md). Uniqueness uses immutable repository ID, pinned branch, and root descriptor path. Repeated/concurrent requests and lost responses resolve to the same durable decision; restart schedules pending deployments even if enqueueing never happened.
- Start by deploying the reviewed immutable revision, then poll the enrolled branch/path for later valid changes. Acceptance authorizes continuing GitOps updates for that descriptor; ordinary commits do not need repeated approval.
- New repositories and new descriptors in an already enrolled repository remain unapproved discoveries. An invalid, unrelated, unapproved file must not block updates to an enrolled service.
- The default branch name at enrollment becomes the tracked branch. A later default-branch change does not silently switch the tracked source. Branch/path changes or adopting a different service ID require an explicit source-change/enrollment decision.
- Repository renames can retain enrollment using immutable repository identity while updating display/remote metadata. Repository transfer outside configured owner scope pauses further tracking and requires an explicit scope/source decision.
- Support accepting or ignoring discovered candidates, showing tracked-source status, and explicitly stopping tracking. Persist those decisions across restarts; rescanning must not automatically re-enroll an ignored or stopped source.
- Removing a discovery owner or losing source access must not delete running services or retained data. Pause affected tracking and surface the condition; resume/rebind only through an explicit authorized source decision when necessary.
- Moving a descriptor path must not implicitly reassign an existing deployment to a new candidate. Provide explicit source rebinding that preserves the existing service identity/data when the owner intends a move.
- Persist discovery/ignore/enrollment audit, pinned sources, and stop/rebind decisions in `_platform/state/controller.yaml`. Git owns application desired state; the local controller owns enrollment/approval metadata. Accepted immutable Git snapshots are restart materializations, not UI overrides. Kubernetes observations or labels cannot manufacture enrollment; secret values remain in host secret files and never enter controller metadata.

### Continuous polling and reconciliation

- Recommended enrolled-source polling interval: 60 seconds, with jitter and bounded retry backoff. Allow an authenticated administrator's UI/API request to enqueue an immediate poll.
- Fetch a specific commit and parse from a stable snapshot. Record discovered, approved/enrolled, fetched, accepted-desired-state, applied, and healthy revisions separately.
- Fetch failures, authentication failures, incomplete discovery, parse failures, and invalid references must not remove the last valid deployed configuration.
- Validate an enrolled service's complete desired state before accepting an updated revision. Kubernetes application is not transactional; report partial application and retry safely.
- Keep durable inventory and exact deletion intents in the same snapshot; pruning verifies ownership and UID/resource-version preconditions, following [reconciliation](reconciliation.md). Preserve namespaces, data/credentials, retained inventory, and identity/path reservations; another source cannot silently acquire them.
- Removing an enrolled descriptor from an otherwise successfully fetched, complete tracked-branch revision can prune its runtime resources, retaining data/credentials by policy. An unreachable repository, missing branch, permission error, or absent discovery result cannot trigger pruning.
- Reject ownership conflicts across repositories or descriptors. Never let source ordering silently choose a winner.
- Do not execute repository scripts, render arbitrary Helm charts, run hooks from Git, or process Git submodules by default.
- Git is authoritative for enrolled application desired state. UI actions must not silently create permanent overrides that the next poll reverses.
- The UI manages discovery, acceptance, tracking, inspection, sync requests, and supported operational actions. Descriptor edits remain repository changes; automated Git writes/PRs are outside initial scope.
- Reverting Git expresses a desired rollback. Retain revision history for diagnosis; do not imply an application rollback reverses database migrations.

## Required verification

- Test user/organization repository enumeration across multiple pages, owner filtering, private-repository credentials, complete root-tree scans, `.sd.yaml` suffix matching, nested/symlink exclusion, malformed descriptors, empty repositories, rate limits, and partial scan failures.

- Verify discovery alone performs no deployment or resource provisioning. Test per-descriptor acceptance, stale-preview rejection, duplicate/concurrent acceptance, persisted enrollment after restart, service-ID conflicts, and unapproved new files in enrolled repositories.

## Reference documentation

- [GitHub repository enumeration APIs](https://docs.github.com/en/rest/repos/repos)
- [GitHub root-tree API](https://docs.github.com/en/rest/git/trees#get-a-tree)
- [GitHub API pagination, conditional requests, and rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
