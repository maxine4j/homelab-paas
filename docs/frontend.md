# Frontend and management API

Status: agreed project specification. Requirements and confirmed decisions below are binding. Implementation recommendations remain recommendations until recorded in an architecture decision; they do not reopen settled product choices.

Read for UI implementation, management API contracts, onboarding flows, or backend SPA/static-file serving.

Read related requirements only when the change crosses those boundaries: [descriptors](descriptors.md), [GitOps](gitops.md), [access and ingress](access-and-ingress.md), [configuration and storage](configuration-and-storage.md).

## Management SPA and API

Current MVP: `GET /api/health` returns an empty HTTP 200 response. The hello-world SPA checks immediately and every five seconds, with a four-second timeout, displaying `healthcheck: up` only for 200 and `healthcheck: down` for errors/timeouts. This is process liveness, not cluster readiness. There are no JSON wire models or management endpoints yet; introduce the canonical shared-contracts crate and schema generation with the first structured API. The MVP uses the same static routing and caching boundaries required below.

- `services/paas-ui` is a Vite SPA with `src/`; its production assets are served by the control-plane backend under the management origin.
- Development may use Vite's dev server with an API proxy; production does not require a separate frontend server.
- Put all backend HTTP endpoints under `/api/`, including login/callback/logout, management, forward-auth, health, and metrics. Treat bare `/api` as part of the API namespace too. Internal endpoints remain restricted even though they share the prefix.
- In production, serve frontend files from `/usr/share/homelab-paas/ui`, with `index.html` at that directory's root. This is an immutable image path, separate from `/var/homelab-paas` host state.
- Serve existing static files for non-API GET/HEAD requests and return `index.html` for SPA navigation routes. Missing assets return 404; unsupported methods return an appropriate method error. Unknown `/api` routes return API errors, never the SPA HTML.
- Use Axum/Tower static-file services with path containment and appropriate content types. Cache fingerprinted assets immutably and require revalidation for `index.html` so deployments do not strand clients on obsolete assets.
- Keep management authorization enforced by API handlers and the configured management ingress policy; serving the SPA does not grant access to management data.
- Users configure domain, DigitalOcean/ACME settings, GitHub OAuth2 credentials/callback, private-application usernames, administrator usernames, discovery owners, and repository-read credential references through the host file before using the UI.
- Once HTTPS and administrator GitHub login work, onboarding shows discovery progress and discovered services. Administrators review a candidate and explicitly accept it to start tracking/deployment; scanning an owner or logging in is not acceptance.
- Show candidate repository/branch/path, reviewed revision, metadata/resource preview, validation/conflict errors, and enrollment status. Show failed/incomplete scans and tracking failures independently of application health.
- Administrator-only settings can manage remaining options, storage aliases, alert receivers, and canonical host-file settings. Access/discovery scope must remain explicit; never infer or automatically append usernames/owners from a login or token's repository list.
- Onboarding must validate and persist the same canonical configuration accepted by file-based setup. It is an authenticated management workflow, with no special CLI, one-time setup token, alternate setup port, or unauthenticated first-run mode.
- Invalid TLS/auth/access bootstrap settings leave management unavailable with local diagnostics. Repository-scan failures remain visible to administrators without disabling management; neither failure mode reopens unauthenticated onboarding or grants access to the first person who logs in.
- Show cluster/service/resource topology, declared dependency edges, observed health, deployed image digests, Git revisions, reconciliation history, storage, certificate status, and monitoring links.
- Clearly distinguish declared topology from observed runtime status; do not imply a runtime traffic map unless traffic is actually measured.
- Provide actionable configuration errors, sync requests, supported restart operations, and explicit data-retention/purge status.
- Reconcile Git ownership with UI capabilities: display/edit cluster configuration locally, but do not silently modify Git-owned application definitions in Kubernetes.
- API contracts include validated request/response schemas, stable error codes, pagination where needed, and secret-redacted representations. SSE may supply status updates without client-side polling storms.
- Do not embed raw Kubernetes editing, interactive shells, arbitrary host-file browsing, or secret-value display by default.

## Frontend conventions

- Keep frontend TypeScript strict and ESM. Use pnpm for its dependency lock, Vitest for UI tests, oxfmt for formatting, and oxlint for linting; TypeScript type checking remains a separate target. All related manifests, configs, scripts, and dependency declarations live under `services/paas-ui`.

- Frontend TypeScript must not use `any`; narrow `unknown` at untrusted boundaries. Prefer `array.at(index)` to indexed array reads.

- Generate frontend wire types from the canonical shared Rust schemas. Keep server-side validation authoritative and do not maintain divergent handwritten interface/schema copies.

## Required verification

- Test API/static routing: valid assets, SPA deep links, absent assets, unsupported methods, and unknown API routes. Ensure API errors never become HTML fallback responses and the packaged bundle is complete.

## Reference documentation

- [Axum](https://docs.rs/axum/latest/axum/)
- [Tower static-file serving](https://docs.rs/tower-http/latest/tower_http/services/struct.ServeDir.html)
