# Homelab PaaS | Agent Guidance

This file defines the standards, architecture, and constraints for AI agents working in this repository.

## Project Overview
Homelab PaaS is a Platform-as-a-Service built on **Docker**, designed for modern Node.js/TypeScript workflows. It enables single-container deployments via a simple descriptor file (`.sd.yaml`), handling DNS, TLS, Ingress, and GitHub OAuth automatically.

### Tech Stack
* **Runtime:** Node.js 24 (use `nvm use`)
* **Package Manager:** Yarn 4.4.0 (**NEVER use npm**)
* **Monorepo Tool:** Turbo
* **Backend:** Koa, Node, SQLite
* **Frontend:** React 19 (Vite), CSR
* **Architecture:** Layered (Datastore > Service > API) + Task-based background processing.

---

## Repository Structure
```
kube-paas/
├── services/
│   ├── paas/          # Koa Backend (The Controller)
│   ├── paas-ui/       # React Frontend (Vite)
│   └── test-service/  # Reference/Test deployment
├── packages/          # Shared TypeScript packages
├── plans/             # Feature design docs (e.g., 01-auth.md)
├── turbo.json
└── package.json
```

---

## Development Workflow

### 1. Strict TDD Protocol
Every feature **must** follow the **Red → Green → Refactor** loop. 
* **RED:** Write a failing test suite colocated with source following the `.tests.ts` naming pattern.
* **GREEN:** Write the *minimal* implementation to pass.
* **REFACTOR:** Clean code and ensure the build still passes.

**Rules:**
* Never write implementation code without a failing test.
* **Exception:** Pure TypeScript types/interfaces do not require Jest tests; they are validated by the compiler.
* **Planning:** Save feature plans to `plans/XX-name.md` before coding.

### 2. Mandatory Commands
| Action | Command |
| :--- | :--- |
| **Setup** | `nvm use && yarn` |
| **Build** | `yarn build` (or `yarn workspace <name> build`) |
| **Test** | `yarn test` (or `yarn workspace <name> test`) |
| **Typecheck** | `yarn typecheck` (or `yarn workspace <name> typecheck`) |
| **Local Dev** | `yarn paas:dev` (Runs via Docker Compose) |

**Dependency Management:** NEVER manually edit `package.json`. Use  `yarn workspace <name> add`.

---

## System Architecture

### Deployment Flow
1.  **Descriptor:** Services provide a `service-name.sd.yaml`.
2.  **Task Queue:** Deployments are enqueued as `Tasks`.
3.  **Runner:** `QueueTaskRunner` executes the deployment logic.
4.  **Networking:** Docker networks and DNS aliases are configured for the service mesh.
5.  **Ingress:** All traffic within the cluster, including ingress, is proxied via the paas container

### Key Components
* **Task System:** Uses `TaskQueue` for background jobs and `Lifecycle` for graceful shutdowns.
* **Storage:** All persistence uses `KeyValueStore<TValue>` (implemented via SQLite).
* **TLS:** ACME DNS-01 challenges (Digital Ocean) providing wildcard certs (`*.rootDomain`).
* **Auth:** GitHub OAuth2 + JWT.

---

## Code Quality Standards
* **No `any`:** Use strict TypeScript. `noImplicitAny` and `strictNullChecks` are mandatory.
* **Layered Design:** Respect the `Datastore > Service > API` bounds. Confirm contracts during the planning phase.
* **Vertical Slicing:** Deliver thin, end-to-end functional slices rather than horizontal layers (e.g., don't build "just the DB schema").
* **Mocks:** Use in-memory stores for tests; avoid external network calls.
