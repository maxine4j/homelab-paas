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
