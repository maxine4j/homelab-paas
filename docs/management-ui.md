# Management UI

The MVP is a read-only React UI served by the control plane at the cluster's base hostname. With auth/TLS configured, open `https://{baseDomain}` (including a nonstandard HTTPS port). Envoy requires the existing GitHub allowlisted session before serving the UI or its API. OAuth accepts this hostname as a return target. Platform cookies are retained only for the management upstream; workload cookie stripping is unchanged. The authentication hostname still exposes only login and callback routes. Management ingress blocks internal health/auth routes and API paths outside `/api/ui/`.

Without auth/TLS, the base hostname serves HTTP without authentication for trusted local development only. No management hostname, credentials, roles, dependencies, or configuration fields are added. Bootstrap port publication remains operator-owned.

## Views

- Cluster configuration: effective validated startup configuration, including defaults and environment overrides, with credentials redacted. Restart the control plane to change it.
- Services: every configured service, its persisted phase and active/desired revisions. Service detail also shows the next retry time. Unobserved services use `unknown`; API summaries additionally include the retry count.
- Service detail: source configuration and the union of resources in the latest valid committed descriptor and observed Docker containers. Resources with no containers remain visible; containers belonging to resources absent from the descriptor remain inspectable with type `unknown`.
- Resource inspection: redacted desired configuration, live container snapshots (including stopped containers, image identity, revision, running flag and networks), and a selectable container's last 200 timestamped stdout/stderr log lines. Docker multiplexed and plain TTY output are supported. There is no log streaming or history pagination.

Snapshots refresh five seconds after each request completes; requests do not overlap within a view. Navigation cancels requests and suppresses stale responses. Refresh/retry controls are available. Empty, loading, unavailable, and missing-item states are explicit. A descriptor read failure preserves observed-resource visibility and marks desired configuration unavailable. Log reads fail closed when the descriptor cannot be loaded for redaction. Snapshots combine independent reads rather than providing a transaction across Git, persisted checkpoints and Docker.

Configuration credentials, literal environment values and command arguments are redacted. Log reads redact exact environment values from the actual container, descriptor environment values and known platform credentials. The API never returns raw Docker inspection payloads, environment values, infrastructure errors or persisted error text. Redaction cannot recognize arbitrary application-generated or transformed secrets: applications must keep credentials out of their logs. Docker response sizes and deadlines remain bounded by the existing transport; oversized or unavailable log tails return an error.

The dark layout uses a sidebar on laptops and wider square foldable viewports, top navigation on narrow phones, a flexible resource grid and scrollable configuration panels. Phone controls have at least 44px targets. Resource tabs and navigation use ordinary hash links, supporting browser history and direct links without another routing dependency.

## API and layers

All endpoints are `GET` (also supporting `HEAD`) under `/api/ui`. Responses use `Cache-Control: no-store`; unknown items return 404, invalid/missing configured sessions 401, and unavailable data 503. Non-read methods are rejected. Unknown API paths never fall back to the SPA.

| Endpoint                                                                  | Result                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `/cluster`                                                                | Cluster identity and redacted effective configuration      |
| `/services`                                                               | Configured services with deployment summaries              |
| `/services/:serviceId`                                                    | Service source, descriptor status/revision and resources   |
| `/services/:serviceId/resources/:resourceId`                              | Resource configuration and live container snapshots        |
| `/services/:serviceId/resources/:resourceId/containers/:containerId/logs` | Bounded, redacted log tail for an owned resource container |

`frontend/paas-ui-router.ts` owns HTTP adaptation and session verification. `PaasUiService` aggregates injected Git, Docker and reconciliation-state interfaces. It serializes UI Git reads in a separate `_paas/ui-git/` cache, avoiding interference with deployment reconciliation. Docker services enforce cluster/service ownership before reading logs; the UI service additionally verifies resource membership. Shared response types live in `@homelab-paas/shared-contracts`.

Frontend `pages/` compose reusable `components/`; `hooks/` own navigation and fetching. The Docker image builds and includes the Vite output; the existing static frontend service serves it. This MVP introduces no mutations, cluster configuration reload, deployment controls, or expansion of the [runtime's supported resource capabilities](configuration.md#implemented-deployment-mvp).
