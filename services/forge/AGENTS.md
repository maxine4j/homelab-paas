# Forge plan and requirements

This document is the authoritative plan and product contract for Forge. Follow the
repository's [agent instructions](../../AGENTS.md) and
[development conventions](../../docs/development.md). Existing implementation is
not a substitute for these requirements. Update this document when changing a
Forge contract; cross-link related documentation rather than duplicating it.

## 1. High-level architecture and tradeoffs

### Product and stack

Forge is an all-in-one agentic development platform: local Git hosting, a Kanban
board, pull requests, a browser IDE, and Codex agent interaction in one web GUI.
Users create projects in Forge, with one Git repository per project initially.

- Build in `services/forge` using the repository's Node.js 24, TypeScript ES
  modules, pnpm, Koa, React, Vite, Zod, Pino, Vitest, Playwright, and Oxc stack.
- Use SQLite for application metadata and local Git repositories for source data.
- Keep the frontend and browser-safe contracts as packages within this service.
  Do not create a separate top-level frontend service.
- Run one Forge Node.js application in one container. The application serves the
  built frontend, HTTP API, live connections, Git HTTPS endpoints, and background
  scheduler. Codex CLI, Git, terminals, and project commands run as child
  processes inside that same container; this is not literally one OS process.
- Do not add a separate runner service, execution container, Docker socket
  dependency, custom model-provider layer, or custom agent tool-execution loop.
- Ask the owner before adding third-party dependencies. Pin Codex CLI and any new
  dependencies to tested versions.

### Layered architecture

```text
HTTP / WebSocket / Git protocol adapters / background tasks
                          |
                    Domain services
                          |
                 Store and client interfaces
                          |
               SQLite / Git / Codex / GitHub / PTY
```

- Entry points validate transport input, call services, and map results and errors.
- Services own authorization, invariants, workflow transitions, and coordination.
- Stores own persistence commands, transactions, serialization, and validation.
- Clients own infrastructure protocols, external-data validation, and translation
  of infrastructure failures into documented caller-facing failures.
- Use classes with constructor-injected interface dependencies. Colocate each
  component's interface with its implementation. Shared module data types belong
  in `types.ts`; shared module errors belong in `errors.ts` when needed.
- Keep framework objects, SQL driver values, and Codex protocol types inside their
  adapters. Public contracts use validated plain values.
- Inject clocks, IDs, timers, configuration, and side effects. No service locators,
  hidden application singletons, or application-module mocks.
- `main.ts` handles process lifecycle. `start.ts` loads configuration, constructs
  dependencies, initializes resources, and registers cleanup.
- Reuse the canonical filesystem, YAML, timer, and logging boundaries. Extract
  genuinely shared infrastructure into a backend workspace package when needed;
  do not import PaaS backend internals or create competing utility implementations.

### Persistence and recovery

```text
/data/
  forge.sqlite
  repositories/{repositoryId}.git/
  worktrees/{workspaceId}/
  codex/
  github/
  artifacts/{runId}/
```

- Git is authoritative for commits, trees, branches, and tags. Bare repositories
  are stored locally on the mounted volume.
- SQLite holds projects, tickets, plan revisions, PRs, reviews, jobs, execution
  state, Codex identifiers, CI mappings, and durable application events.
- Codex owns its conversation history and execution state in its persistent home;
  SQLite stores the identifiers and normalized state needed by Forge. Do not
  invent a second authoritative conversation store.
- Store larger attachments and execution artifacts outside SQLite.
- Use SQLite WAL mode, foreign keys, bounded transactions, and serialized writes
  on a local filesystem. Expose an asynchronous database contract. Evaluate the
  pinned Node release's built-in SQLite support before selecting an adapter.
- Git, SQLite, and GitHub cannot share a transaction. Persist operation intent,
  execute with idempotency or explicit reconciliation, and record completion.
- Recover interrupted repository creation, execution, pushes, and merges at
  startup. Never blindly repeat an agent turn after losing its connection.
- Preserve repositories, credentials, and user data when removing runtime
  resources. Worktrees become disposable only after preserving relevant work.
- Use `recreate` deployments so two Forge instances never operate on the same
  database, worktrees, or Codex home during an update.

### Codex harness and lifecycle

Use Codex CLI's app-server as the built-in harness. Forge orchestrates tickets and
reviews; Codex owns model interaction, tools, agent execution, and conversations.

- Manage one long-lived `codex app-server` child process over stdio JSON-RPC.
- Initialize the protocol connection, then use supported thread, turn,
  notification, interruption, and approval operations. Validate the pinned CLI's
  protocol before implementing integrations; do not invent fields or guarantees.
- Keep app-server private to the backend. Browser clients call Forge APIs rather
  than receiving unrestricted Codex protocol access.
- Map tickets to worktrees, branches, Codex thread IDs, active turn IDs, and
  execution status. Resume the ticket conversation through planning,
  implementation, and requested changes.
- Persist important normalized activity and approval state for browser reconnects.
  Reconcile actual Codex state after app-server or application restart before
  dispatching more work. Surface interrupted or uncertain execution explicitly.
- Start with one active agent turn. Keep scheduling ownership explicit so later
  concurrency does not require redefining the workflow.
- Shut down child processes cleanly and reap descendants. Keep the web UI and
  process health available when Codex is unavailable or unauthenticated.

References: [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
and the local `~/repo/codex-runner` source. Its short-lived setup/proxy connection is
a reference, not the required transport lifecycle for Forge's continuous agent UI.

### Account login and application access

Retain the account setup experience from `codex-runner`, without remote-device
pairing:

- Provide ChatGPT account sign-in in Forge: verification link, one-time code,
  pending/completed/failed states, cancellation, and retry.
- Prefer app-server's structured `chatgptDeviceCode` login operation rather than
  parsing Codex terminal output. Use only fields supported by the pinned version;
  do not fabricate expiry values.
- Retain the GitHub `gh` account login flow for repository pushes and Actions
  access, with verified account status and actionable failures.
- Persist Codex and GitHub credentials in restricted volume directories. Do not
  expose credentials or raw CLI diagnostics in API responses or browser events.
- Account device-code authentication is distinct from remote-device pairing.
  Do not implement mobile pairing codes, remote-control enrollment, or paired
  device management: users interact with agents through Forge's web GUI.
- Initially deploy as a private, single-owner application behind authenticated
  PaaS HTTPS ingress. Validate browser origins for mutations and WebSockets.
- Forge access, ChatGPT login, GitHub login, and Git HTTPS credentials are separate
  concerns. Implement explicit authorization for terminal, file, review, and Git
  operations; do not assume upstream ingress supplies an application actor.
- Authenticated Git HTTPS access must work for ordinary Git clients. Resolve its
  credential and ingress arrangement explicitly before exposing Git hosting; a
  browser session alone is not a Git credential.

#### Slice 1 foundation contract

Forge uses the [PaaS authenticated workload identity
headers](../../docs/networking-and-auth.md#authenticated-workload-identity-headers).
Private ingress (`public: false`) and no published HTTP host port are mandatory:
Envoy strips client identity headers and supplies `X-WEBAUTH-USER`. Forge validates
that GitHub username and authorizes only the configured `FORGE_OWNER`, compared
case-insensitively. Missing, malformed, duplicate, or disallowed identities fail
closed. Optional email/full-name headers never grant access. These assertions are
trusted only on the private proxy path; Forge does not authenticate direct HTTP
clients. Every mutation and future WebSocket handshake requires the exact
configured `FORGE_ORIGIN` HTTPS origin. Services recheck owner authorization.

Backend foundation configuration:

| Variable               | Contract                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| `FORGE_OWNER`          | Required GitHub username; the single application owner.                           |
| `FORGE_ORIGIN`         | Required canonical HTTPS origin, without path/trailing slash.                     |
| `FORGE_DATA_DIRECTORY` | Absolute persistent directory; defaults to `/data`.                               |
| `FORGE_PORT`           | HTTP listener port; defaults to `8080`; no host publication.                      |
| `FORGE_IMPORT_HOSTS`   | Optional comma-separated exact DNS host allowlist; defaults to no remote imports. |

The initial project API exposes `GET/POST /api/projects`,
`GET /api/projects/:id`, and `POST /api/projects/:id/retry`. Inputs and responses
use `@homelab-paas/forge-contracts`; public project values contain only ID, name,
creation timestamp, and `creating/ready/failed` status. Repository IDs initially
equal project UUIDs. Inputs are limited to a 120-character name and optional
2048-character HTTPS source; JSON bodies are limited to 16 KiB. The initial store
supports at most 1000 projects. Errors expose fixed codes, never credentials,
paths, source URLs, SQL, or subprocess diagnostics. `GET /health` is an internal
liveness endpoint and discloses only `{"status":"up"}`.

Creation persists a `creating` intent before Git operations. Bare repositories are
prepared beneath an owned staging directory and published by rename. An exclusive
sibling claim file reserves staging ownership before directory creation; recovery
can complete interrupted initialization without adopting unclaimed directories.
Ownership markers and bare-repository validation are required before adopting any existing
path. Startup reconciles `creating` intents and verifies `ready` paths before
serving requests. Failures retain intent and data as `failed`; only explicit retry
repeats failed work. Recovery never deletes or overwrites unrelated paths. Import
fetches heads/tags idempotently and preserves the remote symbolic HEAD when
available. It does not create a checkout or run hooks/submodules.

Remote import supports credential-free HTTPS on port 443 only, without query or
fragment, against the configured exact host allowlist. The owner must trust the
configured hosts and their DNS/network destinations. Redirects, local paths,
other Git protocols, credential helpers, interactive prompts, hooks, and global
Git configuration are disabled. Each Git command has a 120-second deadline and
1 MiB output bound. Private-repository credentials and authenticated Git HTTPS
hosting are deferred; no Git hosting endpoint is exposed by the foundation.

Pinned Node 24.22.0 was evaluated with built-in SQLite 3.53.4. `DatabaseSync` runs
in a dedicated worker behind an asynchronous contract, with WAL, foreign keys,
full synchronous durability, a five-second busy timeout, serialized requests,
at most 100 statements per transaction, 100 queued requests, and 1000 result rows.
Worker startup/exit failures reject pending operations; close drains accepted work.
Startup must set `umask(0o077)`, create/restrict the data directory to `0700`, and
complete database/schema initialization and project recovery before listening.
The runtime must retain the single-instance `recreate` deployment policy.

The account backend pins `@openai/codex` to `0.164.0`. Its supported account
protocol was checked against that binary's generated JSON schemas and exercised
with a credential-free stdio initialization/account-read integration test. Live
ChatGPT/GitHub sign-in remains a manual validation; automated tests use no live
credentials. One
long-lived private app-server connection initializes once, sends `initialized`,
correlates numeric request IDs, and accepts only the three account operations
needed here. Requests have a 15-second deadline, at most 32 pending requests,
and a 1 MiB maximum JSON frame. A malformed frame, process exit, or missed
deadline rejects pending work and invalidates the connection; no request is
replayed. Status polling may reconnect and read actual account state, but never
starts login or agent execution.

Account APIs are `GET /api/accounts` and
`POST /api/accounts/:provider/{login,retry,cancel}`, where provider is `codex` or
`github`. Mutations accept no fields. They use the same owner and origin policy
as project APIs. Browser-safe contracts expose provider connection availability,
an optional verified account name, and login state
`idle/pending/completed/failed/cancelled/uncertain`. Only pending states carry a
validated provider verification URL and one-time code; expiry is not fabricated.
Failures contain fixed actionable codes: `unavailable` (check CLI installation
and credential-home permissions), `verification-failed` (check connectivity and
account access), `login-failed` (request a fresh code and check device-login
settings), or `connection-lost` (outcome uncertain; verify then explicitly cancel
or retry). Raw CLI diagnostics remain operator-only. Successful login requires
an actual ChatGPT `account/read` or GitHub `gh api user` result; a completion
notification or zero exit code alone is insufficient.

SQLite `account_login_attempts` stores only pending intent, never codes, IDs or
credentials. Intent precedes login. After application restart, an interrupted
attempt remains uncertain alongside the verified current account until explicit
cancel/retry. An uncertain Codex attempt resets the old app-server connection
before another login; late notifications cannot complete a replacement attempt.
GitHub login uses `gh auth login --web --insecure-storage` against `github.com`
with HTTPS Git, validates the known device prompt, bounds prompt/verification
commands to 15 seconds and 64 KiB output, and stops an outstanding login after
a local 15-minute deadline. This deadline is not a provider code-expiry claim.

Account process initialization creates/restricts `/data/codex` and `/data/github`
to `0700` and existing credential files to `0600`. Startup's `0077` umask applies
to new credentials. Codex uses `cli_auth_credentials_store="file"`; GitHub uses
`GH_CONFIG_DIR`. Child environments exclude ambient API keys and GitHub tokens,
so verified account status reflects persistent credentials. One process adapter
owns at most one app-server. Children run in dedicated Unix process groups;
shutdown sends TERM, waits up to one second, then KILLs the group and awaits
direct-child stream closure. A naturally exiting leader also terminates remaining
group members. Descendants that deliberately escape their process group are
outside this boundary; container startup must provide an init process to reap
orphaned descendants. Long-lived Codex stderr retains a bounded 64 KiB diagnostic
tail rather than accumulating without limit. Recreate deployment remains mandatory
to prevent multiple application instances sharing account homes.

Slice 1 serves a responsive React interface from the same application as its API.
Owners can list/create/import/retry projects and connect ChatGPT/GitHub using
verification links, one-time codes, cancellation, verification and explicit retry.
Account polling is serialized with actions, aborts on unmount, and never blocks
project use. Failed creation refreshes durable project intent for explicit retry.
All API responses are validated by the browser; device links are limited to the
provider's exact verification page. No editor, terminal, tickets, PRs or agent-turn
UI is included in this slice.

Production startup restricts the data root, initializes SQLite/schema and recovers
projects before listening. Codex initializes asynchronously after HTTP starts;
unavailable account processes/homes do not withhold health or project access.
Account checks/retries reattempt credential-home initialization after permission
repairs. GitHub verification uses bounded, separate stdout/stderr: `gh api
--include user` must return a validated HTTP 200 and username; HTTP 401 means
signed out, other failed verification stays unavailable. Shutdown closes HTTP,
GitHub and Codex before SQLite, in reverse acquisition order. HTTP stops accepting
requests, then cancels owned Git process groups before waiting for request drain;
SQLite remains available to persist failed import intents. Git helpers are also
terminated on leader exit and the 120-second deadline, with a 1 MiB combined
output bound and injected timers. Interrupted startup recovery finishes recording
its result before database closure. Expected process
shutdown does not report a provider failure. Partial startup and listener errors
exit unsuccessfully after registered cleanup.

Built assets require owner access, reject traversal/symlinks, and serve only
approved public file types. Navigation falls back to the frontend; unknown
`/api` paths return JSON 404 and missing assets never fall back. Hashed assets
use private immutable caching; HTML/API responses use no-store. CSP permits
same-origin scripts and styles, allows inline style elements needed by the editor
and terminal, and blocks framing; device pages open separately. The explicit
`style-src-elem 'self' 'unsafe-inline'` exception does not authorize inline scripts,
eval or inline style attributes. Browser validation configures Zod's supported
`jitless` mode before loading schemas, avoiding its eval capability probe.

#### Run, package and verify slice 1

Run `nvm use` from the repository root before the following commands:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:integration
pnpm build
pnpm test:forge:browser
pnpm image:forge
pnpm test:forge:image
```

Browser tests use controlled API responses in Chromium, including mobile layout,
account setup states and project recovery controls. They do not claim production
ingress authentication or live login. Install the repository's pinned Chromium
with `pnpm --filter @homelab-paas/forge-ui exec playwright install chromium` if
needed. Screenshots/diagnostics live under ignored `artifacts/forge*/`.
The image smoke uses a disposable Docker volume and internal container HTTP,
with no host ports. It checks nonroot execution, restricted directories, real
Git/SQLite recovery, synthetic credential-home file persistence, bundled Codex
initialization/account-read, shipped gh flags and signed-out verification,
orphan reaping, graceful signals, partial startup and listener failures. A separate
composition test uses a controlled Git CLI peer for a hanging remote fetch:
real HTTP/SQLite shutdown cancels its group and preserves a failed project for
explicit retry. It does not claim a live remote import or bypass HTTPS validation.
The gh
signed-out check reaches GitHub's credential-free `/user` endpoint; it needs
network connectivity. It never performs a real login. Real credential persistence
and successful live ChatGPT/GitHub login remain manual checks.

`pnpm dev:forge` builds contracts/infrastructure/frontend and watches the backend;
set `FORGE_OWNER`, `FORGE_ORIGIN` and an absolute writable `FORGE_DATA_DIRECTORY`
first. This is a private proxy workload: browse through authenticated HTTPS PaaS
ingress. The standalone Vite server is used for controlled browser tests; it does
not inject a trusted application identity or provide an alternative login.

The image is one Node 24.22.0 Debian trixie application (glibc, avoiding musl
compatibility assumptions), UID/GID 1000, with Git 2.47.3, gh 2.46.0, pinned
Codex 0.164.0 and approved tini 0.19.0 as PID 1. Exact tested Debian package
revisions are in `Dockerfile`; dependency changes require revalidation. Tini
reaps orphaned descendants. Process-group cleanup covers ordinary descendants;
deliberately escaped live processes are outside that application-level boundary.

`forge.sd.yaml` uses private ingress, one replica, recreate rollout and persistent
`/data`, with no HTTP host ports. Its deployment defaults set `FORGE_OWNER` to
`maxine4j`, derive `FORGE_ORIGIN` from `https://${SERVICE_DOMAIN}`, and allow
credential-free HTTPS imports from `github.com` through `FORGE_IMPORT_HOSTS`.
No owner secret file is required. The production cluster must allow `maxine4j`
through its GitHub login and provide authenticated HTTPS ingress on port 443.
For another deployment, edit the literal owner, origin or exact DNS import
allowlist as appropriate; an empty import allowlist disables remote imports.
The [PaaS service secret file](../../docs/configuration.md#environment-variables-and-secrets)
can supply an environment value only when its descriptor entry uses `secret: true`;
undeclared secret-file entries are not injected. Keep credentials out of literal
descriptor values. Private-repository imports remain unsupported, including after
GitHub account sign-in.
Build locally with `pnpm image:forge`; CI builds and validates
the image and publishes `ghcr.io/maxine4j/homelab-paas/forge` with full SHA,
release-tag or main `latest` tags under the repository's image convention.
Building does not deploy the descriptor; add it to platform configuration only
when ready, retaining the [private ingress trust boundary](../../docs/networking-and-auth.md#authenticated-workload-identity-headers).

#### Slice 2 terminal contract

The supported terminal runtime is the Node 24 Debian Linux container. Native
macOS/Windows terminal requests return `terminal-unavailable`; health, accounts,
and workspace APIs remain available. `node-pty` 1.1.0 and `ws` 8.22.1 are pinned;
native build prerequisites live only in image build stages and the integration
runner. Native-module loading is deferred until explicit terminal creation.

Browser contracts are exported from `@homelab-paas/forge-contracts/terminal`.
Owner services verify workspace ownership and readiness before starting `/bin/sh -i`
at its verified path. Shell environment contains only PATH, workspace HOME,
LANG, TERM, `HISTFILE=/dev/null`, and `ENV=/dev/null`; ambient credentials and shell
startup configuration are excluded. The shell shares the application's mounted
storage and UID. Workspace API branch protection is not hostile shell containment;
arbitrary shell commands can change shared files and Git metadata. No pause or
foreground-job suspension guarantee is offered.

| Route                                  | Contract                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /api/workspaces/:id/terminal`    | Explicit create `{cols,rows}`; returns session, HTTP 201. Never implicit on attach.          |
| `GET /api/workspaces/:id/terminal`     | Latest retained `{session?}`; absence is `{}`.                                               |
| `GET /api/terminals/:id`               | Inspect one session.                                                                         |
| `DELETE /api/terminals/:id`            | Close live shell, await cleanup, retain metadata/files.                                      |
| `WS /api/terminals/:id/socket?after=N` | Attach an existing session; exact configured HTTPS Origin and owner required before upgrade. |

Sessions expose UUIDs, workspace ID, dimensions, timestamps, normalized
`starting/running/exited/closed/lost` status, and optional exit code; never paths,
PIDs, raw diagnostics or environment. SQLite intent precedes spawn. Startup marks
interrupted active records `lost`; it never silently replaces a shell. Disconnect
only detaches the browser. A fresh shell always requires explicit create.

WebSockets accept JSON `{type:"input",data}` or `{type:"resize",cols,rows}`.
Server frames are `{type:"output",sequence,data}`, `{type:"gap",through}`, and
`{type:"status",session}`. Sequence starts at 1 per session; reconnect supplies
the last rendered sequence as `after` (default 0, nonnegative safe integer).
Replay precedes status and subsequent live output. A gap means bytes through
that cursor are unavailable; reconnect to a retained ended/lost session sends a
gap at the supplied cursor then status. Clients must show the interruption and
must not infer a new shell from an empty replay. Transcripts are bounded transient
memory, never authoritative durable history. Terminal bytes are never logged.

Bounds: one live shell per workspace, eight live shells overall, 1000 retained
session records, four browser attachments per live shell, 32 sockets overall,
16 pending upgrades (five-second deadline), four queued frames per socket, and
64 service operations. Dimensions are 2–500 columns and 1–200 rows. Client wire
frames and input chunks are at most 16 KiB; accepted input is at most 1 MiB per
session. Replay holds at most 256 KiB/1024 frames; output chunks split at Unicode
code points. A slow socket is disconnected above 256 KiB queued output. A shell
closes after eight hours or 16 MiB output. Socket ping/pong detects abandoned
connections. Limits fail explicitly with fixed terminal error codes; a new shell
requires explicit owner action.

Shutdown terminates sockets and owned PTY sessions before SQLite closure. Linux
`/proc` inventory uses the canonical filesystem boundary, captures session leader
start time and device, and selects groups by that SID, including ordinary jobs
whose controlling terminal clears on leader exit. It rejects a reused leader.
Inventory is capped at 4096 `/proc` entries and one second per cancellable scan.
Cleanup sends TERM, waits at most a
second, then KILL and awaits PTY exit with a one-second bound. Natural leader exit
also cleans remaining session groups. Tini reaps orphans. Processes deliberately
escaping their session (for example `setsid`) are outside this application cleanup
boundary. This is not a sandbox; containers retain the existing resource limits.

Run host unit tests/checks normally. On macOS the real Linux PTY integration cases
are explicitly skipped; `pnpm test:containers integration` runs them in the
supported Linux runner (whose Python/make/C++ tools build node-pty). Also run
`pnpm image:forge` and `pnpm test:forge:image` to verify nonroot glibc packaging.
The [node-pty build requirements](https://github.com/microsoft/node-pty#dependencies)
and [ws upgrade authentication](https://github.com/websockets/ws#client-authentication)
define the external adapter setup. No live credentials are needed for these tests.

#### Slice 2 manual workspace foundation

Manual workspaces are project resources without tickets in milestone 2. Ticket
linkage and agent pause/edit/resume enter with the later ticket/agent slices;
this slice does not dispatch turns, schedule jobs, host Git HTTPS, run remote CI,
or merge `main`.

`@homelab-paas/forge-contracts` exports workspace schemas from `workspace.ts`.
Workspace values contain ID, project ID, name, deterministic
`forge/workspace/{workspaceId}` branch, creation timestamp, creation `baseSha`,
status (`creating/ready/failed/archived`), and current `head` when ready. They never
contain filesystem paths. Creation starts from local `main`; an entirely empty
repository gets one empty Forge initialization commit on `main`. A nonempty
repository without `main` requires operator repair and fails closed. No API
switches branches or writes directly to an existing `main`.

Workspace routes, all subject to the foundation owner/origin policy:

| Route                                          | Contract                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET/POST /api/projects/:projectId/workspaces` | List/create; creation accepts `{name}`.                                        |
| `GET/PATCH/DELETE /api/workspaces/:id`         | Inspect/rename/archive; PATCH accepts `{name}`.                                |
| `POST /api/workspaces/:id/retry`               | Explicitly retry failed creation; archived workspaces remain archived.         |
| `GET /api/workspaces/:id/tree?path=`           | One directory level, up to 1000 entries, explicit truncation.                  |
| `GET /api/workspaces/:id/file?path=...`        | UTF-8 text, SHA-256 content version.                                           |
| `POST/PUT /api/workspaces/:id/file`            | Exclusive create `{path,content}` / save `{path,content,version}`.             |
| `GET /api/workspaces/:id/diff`                 | Separate branch, staged, unstaged, untracked sections.                         |
| `POST /api/workspaces/:id/stage` or `/unstage` | `{paths}`: 1–100 explicit files; directories/globs are not staged recursively. |
| `POST /api/workspaces/:id/commit`              | `{message,expectedHead}`; atomic expected-head branch update.                  |

SQLite intent precedes worktree creation. Exclusive claims and immutable base
markers live beside worktrees, outside editable/visible source. Git worktrees are
locked against pruning; recovery verifies claims, repository ownership, linked
worktree metadata and branch identity before use. Interrupted creation may
complete; failed state needs explicit retry. Recovery never resets branches,
overwrites files, adopts unrelated paths, or deletes partial work. Archives retain
SQLite metadata, worktree, branch and files; file/Git operations reject archives.
The initial limit is 1000 retained workspaces across projects.

Files are limited to 256 KiB of valid UTF-8 without NUL. Absolute paths, traversal,
backslashes, control characters, symlinks, Git metadata and `.forge-*` components
are rejected. Existing parent directories are required when creating a file.
File mutation JSON bodies allow 2 MiB for JSON escaping; other bodies retain the
16 KiB limit. Version mismatches fail with `file-conflict`; simultaneous Forge
saves using one version have one winner. API operations share a serialized
application queue. Atomic replacement preserves executable permissions. These
checks detect observed external edits; arbitrary local shells share storage and
cannot provide cross-process atomic editor saves or hostile process isolation.

Branch diffs compare `merge-base(main, workspace)..workspace`, independently of
the recorded immutable creation base. Each of the four sections contains at most
100 paths, 1000 patch lines and 256 KiB patch bytes, with explicit `truncated`
metadata. Binary/non-UTF8 content has path metadata without text patches. Git
commands retain their 120-second/1 MiB process bounds; a diff command exceeding
its output bound yields explicit truncation. Restricted metadata is omitted from
diff previews and cannot be committed through Forge. Diff results are observations
of shared mutable Git/files, not transactional snapshots against terminal commands.

Safe errors are `invalid-request`, `workspace-not-found`, `workspace-unavailable`,
`workspace-conflict`, `file-not-found`, `file-conflict`, and `file-unsupported`.
HTTP maps them to 400/404/503/409/415 respectively, without diagnostic strings.
Services recheck owner authorization for all operations. Internal
`IWorkspaceService.resolve(actor,id)` returns the verified path for future terminal
integration; entry points must never serialize it. Future PR services can inspect
workspace identity/head through the same service interface. Startup initializes
the workspace store and completes recovery before listening.

#### Slice 2 integrated manual workspace and PR review

Forge uses a dark GitHub-style layout throughout, including the editor, forms,
diffs and account setup. Global navigation separates Projects from Config at
`#/config`; ChatGPT/GitHub status, device-code login, cancellation and retry live
only on Config. Account errors never clutter project views. Switching to Config
preserves the open project and its unsaved drafts.

Projects retains creation/import/retry. Opening a ready project shows its identity
and five section tabs, in order: Code, Tasks, Agents, Pipelines, Terminals.
Code is the default. Tasks, Agents and Pipelines explicitly say they are not
available yet; no ticket, agent-turn or remote CI functionality is implied.
Tab navigation stays usable on narrow screens without widening the page.

Workspaces are internal execution resources, not a user-facing concept. Do not
show workspace creation, selection, archival, names, generated branches or raw
execution identifiers. The current file/terminal adapters still use the internal
workspace APIs: reuse the project's retained non-archived checkout (prefer the
internally named Project files checkout), or prepare one automatically when none
exists. A failed checkout requires explicit Retry opening files. Preparation
never starts an agent or shell. Preserve existing files and metadata.

Code contains a GitHub-style bordered directory listing followed by a safe README
preview. Each directory initially shows ten entries, with Show all/Show fewer
controls; the 1,000-entry server bound remains explicit. Folder and common file
types have themed icons. Opening a file replaces the overview with the editor;
Back to files preserves drafts. The left directory tree appears alongside code on
tablet and laptop widths (above 600 CSS pixels), and is hidden on slab phones.

The branch dropdown defaults to Working changes, the retained editing checkout.
Local file dates are filesystem modification timestamps. Other named branches
show committed files read-only, with each entry's latest commit subject and date.
Browsing never switches or resets the editing checkout. Internal generated branch
names stay out of the dropdown. A history icon in the top-right of the file panel
loads the selected branch's commits, thirty at a time, with explicit pagination.
Pagination rejects a changed branch head rather than mixing histories.

Read-only repository APIs are under `/api/projects/:id/repository`: `branches`,
`tree?branch=&path=`, `file?branch=&path=`, and `history?branch=&offset=`. They
validate owner/project readiness, exact branch names and safe paths. Git reads
resolve the branch to a commit before reading content. They use bounded system
Git commands, at most 1,000 branches/entries, at most eight concurrent per-entry
log reads, and the existing 256 KiB text-file bound. Symlinks, submodules, binary
content and restricted metadata cannot be opened as code. Errors reuse the safe
workspace/file error contract. Repository HTML is displayed as text, never executed.

Code includes Changes and Pull requests
in initially collapsed disclosures. PR review includes closed PRs. Terminals
contains the shell controls and output. Remove infrastructure notes, raw revision
summaries and session IDs from the primary UI; retain actionable errors, file
conflict recovery, terminal connection/loss states and review approval status.
Git HTTPS hosting and merging remain unavailable.

The responsive workspace combines directory navigation, file creation, editor
tabs, real CodeMirror 6 editing (JavaScript/TypeScript highlighting), four change
comparisons and a real xterm.js 6 terminal with its fit addon. API responses are
validated against browser-safe contracts. Tabs retain drafts; project
navigation and page exit guard unsaved edits. Saves send the observed content
version. A conflict keeps the local draft and offers an explicit server-content
comparison followed by an explicit discard/reload action. Typing while a save is
pending remains dirty after that save completes. External shell edits remain
subject to the [workspace version-check boundary](#slice-2-manual-workspace-foundation).

Changes label branch (merge base to HEAD), staged (HEAD to index), unstaged (index
to worktree), and untracked comparisons separately. Each section shows its files,
inline patch, binary markers and truncation. Stage/unstage act on explicit paths;
commit sends the HEAD observed with that diff and rejects a changed branch.
The workspace and PR adapters share `GitDiffClient` for tracked patches.

Terminal creation and closure are explicit. Opening the Terminals tab inspects its
retained session and may attach that session, never creates a shell. Disconnects
offer reconnect to the same session; replay gaps remain visible for that session.
Lost/exited states remain explicit. Reconnect drains xterm's public write queue
before choosing the rendered cursor, and new sessions reset the display only
after old writes drain. Input chunks include JSON escaping in the 16 KiB wire
bound. Fit observes container resize and sends bounded PTY dimensions.

PR summaries contain metadata only; patches/discussion are fetched on explicit
detail/diff reads. The browser loads a committed diff before enabling revision
mutations. Detail and diff revisions must match; mismatch/failure clears the
actionable diff. Create explicitly previews the current refs; review/comment,
metadata and status mutations send the refs of the displayed diff. Backend
`revision-conflict` requires an explicit refresh, so a stale displayed patch
cannot be approved using independently refreshed refs. Approvals become stale
if either main or workspace HEAD changes. Archived/failed/missing source
workspaces retain metadata/discussion while approval is unavailable.

Browser-safe PR contracts are exported from
`@homelab-paas/forge-contracts/pull-requests`. All routes retain owner/origin checks:

| Route                                                    | Contract                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET/POST /api/projects/:projectId/pull-requests`        | Summary list / create `{workspaceId,title,body,expectedHead,expectedBase}`.    |
| `GET /api/workspaces/:workspaceId/pull-request-revision` | `{revision,hasChanges}`; `baseSha` is current main, with separate `mergeBase`. |
| `GET/PATCH /api/pull-requests/:id`                       | Detail / expected refs plus optional title/body or `status: open/closed`.      |
| `GET /api/pull-requests/:id/diff`                        | Explicit committed patch, comparison label and revision.                       |
| `POST /api/pull-requests/:id/comments`                   | Expected refs and body.                                                        |
| `POST /api/pull-requests/:id/reviews`                    | Expected refs, body and `approve/request-changes`.                             |

There is no merge endpoint. Review requests and discussion persist in SQLite;
startup initializes their store and registers the production router. Tests cover
real Git revision races, persistence and unavailable sources, controlled browser
editor/terminal/review flows, mobile width and screenshots. A separate production
bundle fixture uses the actual `HttpApplication` CSP and `StaticAssets`, without
Vite's development runtime, to check terminal style compatibility. This check must
pass before the integrated UI is considered production ready; do not weaken CSP
or patch third-party DOM internals to bypass a failure.

Run the checks listed [above](#run-package-and-verify-slice-1), plus
`pnpm test:containers integration` for the supported Linux PTY runtime. The image
smoke verifies production workspace/PR routing and native terminal packaging.
Browser artifacts remain under `artifacts/forge*`.

Production CSP explicitly permits generated style elements through
`style-src-elem 'self' 'unsafe-inline'`, approved after the production xterm probe
demonstrated eight blocked style elements under the original policy. All script
and other restrictions remain. The integrated production browser case checks
the actual built application/editor/terminal on desktop and mobile, no unexpected
policy violations, real syntax colors/output, and an intentional inline script
that remains blocked. It uses controlled API/WebSocket data; native PTY/PR runtime
behavior is verified separately in Linux integration and the real image smoke.

### Ticket and PR workflow

```text
draft -> ready -> planning -> plan review -> working -> work review -> merging -> done
```

| Stage       | Required behaviour                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Draft       | Human defines scope and acceptance criteria.                                                                              |
| Ready       | Explicit authorization for the scheduler to claim the ticket.                                                             |
| Planning    | Create a branch and worktree from the latest local `main` SHA; Codex produces a versioned plan.                           |
| Plan review | Human approves that plan revision or requests changes, returning to planning.                                             |
| Working     | Codex implements the approved plan and opens the ticket's PR.                                                             |
| Work review | The PR itself: diff, discussion, checks, approval, and requested changes. Requested changes return the ticket to working. |
| Merging     | Prepare and validate the merge candidate, then update protected `main`.                                                   |
| Done        | The PR has merged.                                                                                                        |

- Work review is the PR. Do not introduce a separate ticket-outcome model where
  raising a PR completes the ticket or independently authorizes merging.
- PRs are repository entities linked directly to tickets; synchronize their
  lifecycle with ticket transitions through application services.
- Track blocked, failed, and cancelled execution separately from board stages.
- Record the planning base SHA. If `main` changes before implementation, assess
  plan validity; material scope changes require another plan review.
- Approvals identify the plan revision or code revision being approved. Code
  changes invalidate affected work approval; enforce transition guards regardless
  of whether the caller is a browser, scheduler, or agent integration.
- Use SQLite-backed jobs with atomic claims, leases, heartbeats, bounded retries,
  and cancellation. Reconcile existing execution before retrying expired work.

### Git hosting and remote CI

- Support project/repository creation and import; authenticated HTTPS clone,
  fetch, and push; file browsing with syntax highlighting; commit and branch
  views; diffs; PR comments, approvals, check status, and merging.
- Use system Git and its HTTP backend rather than implementing the Git protocol.
- Protect `main` across browser operations, agent operations, and external pushes.
  Receive-side enforcement is required for hosted Git pushes.
- Start with squash merging and serialized merge operations per repository.
- Forge is authoritative for Git and PRs. GitHub is the CI execution mirror;
  initially do not create a second set of GitHub PRs or synchronize their reviews.
- Push an immutable candidate commit to a dedicated GitHub branch with a configured
  push-triggered Actions workflow. Track repository, workflow, candidate SHA, and
  attempt; a successful push alone does not establish that CI ran or passed.
- Poll the Actions API to recover status; signed webhooks may accelerate updates
  when an authenticated, reachable webhook endpoint is configured.
- Show CI status and remote log links in Forge's PR view. Run intensive CI builds
  on GitHub-hosted infrastructure, not on the homelab.
- Construct the final squash candidate against current `main` before CI. Advance
  `main` to that exact tested commit only if the expected base and approvals remain
  valid. If the base changes, rebuild and retest. Reconcile remote mirror updates
  separately from the local authoritative merge.

Use the local `~/repo/forgejo` source as a behavioural reference, especially Git
hosting, bounded diff responses, expected-head validation, and merge concurrency.
Forge remains a TypeScript implementation, not a Forgejo deployment or fork.

### Integrated agent workspace

One screen must combine:

- Agent conversation, streamed activity, approvals, sending messages, and
  interruption controls.
- Branch changes against `main`, a changed-file list, and inline diffs. Use the
  merge base of `main` and the branch for the branch's introduced changes; label
  the comparison clearly. Show staged, unstaged, and untracked workspace changes
  separately so edits are visible before commit.
- A file tree, editor tabs, file opening/saving, and basic syntax highlighting.
- A PTY-backed interactive terminal rooted in the ticket worktree, with resize and
  reconnect support. Browser disconnection must not silently start a second shell;
  distinguish reconnecting to a live terminal from a shell lost on process restart.
- PR discussion, CI results, approval/request-changes controls, and merging.

Generate diffs from Git with explicit file/line/output bounds and binary handling.
Prevent silent editor/agent overwrites with file-version checks and an explicit
pause/edit/resume workflow. Do not promise full language-server, debugger,
extension-marketplace, or collaborative-editing support for the initial version.

### Alternatives, constraints, and delivery order

| Choice                                | Tradeoff                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One application/container             | Simple deployment and ownership; all child processes share resources and a trust boundary.                   |
| Codex app-server                      | Reuses the supported agent harness; requires protocol pinning, event mapping, and lifecycle recovery.        |
| Local Git plus SQLite                 | Meets local ownership requirements; requires reconciliation across Git, database, and remote effects.        |
| Custom TypeScript forge               | Coherent stack and workflow; Git hosting and review correctness remain substantial implementation work.      |
| Forgejo-backed application            | Mature hosting, but adds another application/runtime and split ownership; outside the selected architecture. |
| Lightweight editor such as CodeMirror | Fits basic editing/highlighting; new dependency requires approval.                                           |
| Monaco                                | Richer editor foundation with greater integration weight; not required for initial scope.                    |

Worktrees isolate working files, not processes or shared Git metadata. Do not claim
hostile multi-tenant isolation or that branch protection prevents arbitrary shell
commands from mutating accessible storage. Use Codex's supported workspace sandbox
and approval controls where verified in the pinned runtime; do not automatically
copy `codex-runner`'s full-access defaults. Avoid passwordless sudo and unnecessary
privileges. Define resource/output/time limits for child processes. Remote CI does
not remove local costs for dependency installation, agent commands, or terminals.

Deliver in slices:

1. Local projects, Git repositories, SQLite, account setup, and Codex connection.
2. Manual workspace editor/terminal/diff and PR review workflow.
3. Ticket scheduling, Codex planning, and plan review.
4. Agent implementation, live interaction, approvals, and recovery.
5. GitHub Actions integration and exact-tested-commit merging.

## 2. Expected source and package structure

Organize backend modules by capability, with service/store/client boundaries within
each module. Do not introduce empty abstractions solely to fill this tree.

```text
services/forge/
├── AGENTS.md
├── package.json
├── Dockerfile
├── forge.sd.yaml
├── tsconfig.json
├── tsconfig.build.json
├── packages/
│   ├── contracts/
│   │   ├── package.json
│   │   └── src/                    # Browser-safe schemas and DTOs
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── app.tsx
│           ├── main.tsx
│           ├── api/
│           ├── components/
│           └── features/
│               ├── setup/          # ChatGPT and GitHub login
│               ├── projects/
│               ├── board/
│               ├── repository/     # Files, branches, commits
│               ├── workspace/      # Integrated development screen
│               ├── agents/
│               ├── editor/
│               ├── terminal/
│               ├── diff/
│               └── pull-requests/
├── src/
│   ├── main.ts
│   ├── start.ts
│   ├── config/
│   ├── http/                       # Server, errors, assets, health
│   ├── auth/                       # Forge access/session policy
│   ├── projects/
│   ├── repositories/               # Git hosting, browsing, ref policy
│   ├── tickets/                    # Board and transition rules
│   ├── plans/                      # Plan revisions and approval
│   ├── pull-requests/              # Work review, comments, merge
│   ├── workspaces/                 # Worktrees and file access
│   ├── terminal/                   # PTY lifecycle and socket adapter
│   ├── agents/
│   │   ├── agent-router.ts
│   │   ├── agent-service.ts        # Ticket-to-Codex orchestration
│   │   ├── agent-run-store.ts
│   │   └── types.ts
│   ├── codex/
│   │   ├── codex-process.ts
│   │   ├── codex-connection.ts
│   │   ├── codex-client.ts
│   │   ├── codex-login-service.ts
│   │   ├── codex-event-mapper.ts
│   │   └── types.ts
│   ├── github/                     # gh login, pushes, Actions API
│   ├── ci/                         # Check policy, candidate tracking
│   ├── jobs/                       # Scheduling and restart recovery
│   ├── events/                     # Durable events and live delivery
│   ├── database/                   # SQLite and initial schema
│   └── artifacts/
└── tests/
    ├── integration/
    └── e2e/
```

Add `services/forge/packages/*` explicitly to the pnpm workspace when implementing
the packages. Keep Forge contracts separate from PaaS product contracts. Frontend
code imports only browser-safe contracts, never backend implementation modules.

Colocate unit tests with components. Use injected fakes for service tests, real
local Git/SQLite for adapter integration tests, and controlled protocol peers for
Codex connection/event/recovery tests. Cover account login without live credentials.

Prioritize job claiming and restart recovery, worktree creation, diff semantics,
file-save conflicts, terminal lifecycle, branch protection, approval invalidation,
and exact-tested-commit merging. The central E2E scenario is:

```text
create project -> ready ticket -> review plan -> agent implementation
-> PR/work review -> GitHub CI -> merge exact tested commit -> done
```

Automated tests must not require live ChatGPT or GitHub credentials. Separately
report manual verification of real login, Codex execution, remote CI, and credential
persistence when those integrations are implemented.
