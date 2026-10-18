# CP-06 — Establish the application runtime

Milestone: [M1](../_milestones.md) · Status: Not started · PR: —

Provide bounded, cancellable infrastructure for background controllers and outbound HTTPS.

## Dependencies

[CP-03](../m1/CP-03-host-configuration.md), [CP-04](../m1/CP-04-controller-persistence.md).

## Read first

- [platform spec](../../platform-spec.md)
- [reconciliation](../../reconciliation.md)
- [build and ci](../../build-and-ci.md)
- [frontend](../../frontend.md)

## Scope

- Extract application state and lifecycle supervision with graceful task and HTTP shutdown.
- Call `loadBootstrapConfig` from `services/paas/src/start.ts` using the canonical host storage root before starting HTTP management or background effects. It composes `BootstrapConfig` in `src/util/host-config.ts` with the POSIX host-file adapter. The loader performs synchronous startup I/O; use a worker if invoked after serving starts. Invalid configuration must keep management unavailable. Wire host configuration/secret mounts into local development at the same time; CP-03 supplies the loader without changing the health/hello-world lifecycle.
- Start effects only after controller state recovery/migrations under the lifetime lock. Shutdown stops mutations, cancels and awaits workers and disk commits, then releases the lock; no worker may act after release. Controller replacement stops the previous process first.
- Provide reusable timed asynchronous HTTP clients, credential-safe redirect policy, bounded work, and structured operation context.
- Preserve process liveness and add explicit readiness semantics; package pinned outbound HTTPS trust roots in the runtime image.

## Decisions to resolve

Record readiness conditions and task failure/restart behavior before wiring controllers. Record owner decisions before implementing dependent behavior; this ticket does not authorize inventing product policy.

## Acceptance criteria

- [ ] Shutdown cancels/drains tasks within deadlines and surfaces task failures without hanging.
- [ ] Health remains process liveness; readiness does not confuse a failed Git scan with loss of management availability.
- [ ] Packaged HTTPS clients validate trust, apply timeouts, and do not leak credentials through logs or redirects.

## Verification

Test cancellation, shutdown deadlines, readiness states, timed-out outbound requests, and runtime-image trust-root contents. For implementation changes, run `pnpm check`, `pnpm test`, and `pnpm build`; see [shared completion rules](../_milestones.md#sequencing-and-verification). Keep Docker/K3s and external-service integration explicit and separate from ordinary tests.

## Completion

- [ ] Scope, acceptance criteria, and verification are complete; record evidence and the PR link here.
- [ ] Update this ticket's status and the corresponding checkbox in [the milestone index](../_milestones.md).
