# Agent instructions

## Project

homelab-paas is a single-host platform using Docker Engine, Envoy, and one TypeScript/Node.js control-plane container. Docker Compose is used only for the local development bootstrap; see [development](docs/development.md#local-container-environment).

The documents below define the intended platform. Align changes with them; existing implementation is not the source of product requirements. Keep the management UI as a stub until its requirements are defined.

## Working rules

- Be terse and direct. Challenge assumptions that conflict with requirements or evidence.
- Use `apply_patch` for file edits.
- Use the proper tool. If it fails, diagnose it or ask the user for help; do not invent unreliable workarounds.
- Preserve the existing Node.js 24, pnpm, TypeScript, Vitest, and Oxc tooling. Use repository scripts and configuration.
- Ask the owner before adding a third-party dependency.
- Keep requirements in one authoritative document and cross-link related topics. Update the relevant document when changing a contract.
- Never expose secrets in logs or status responses. Preserve persistent data and generated credentials when removing resources.
- Backend filesystem operations use `src/util/file.ts`; YAML parsing and serialization use `src/util/yaml.ts`; timers use injected `ISleep` from `src/util/sleep.ts`. Only the filesystem utility's boundary tests use raw filesystem APIs to independently verify persisted bytes and permissions. See [development](docs/development.md#backend-infrastructure-boundaries) for adapter exceptions.
- `main.ts` and `start.ts` are exempt from unit-test and unit-test TDD requirements for process setup, composition, and startup/shutdown wiring. Validate them with typechecking, builds, and appropriate startup smoke checks. Keep business logic in separately tested modules.

## Read for the task

Read [architecture](docs/architecture.md) before platform changes, then the relevant documents:

| Task                                                                                      | Required reference                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Configuration, descriptors, validation, secrets, volumes, limits                          | [Configuration](docs/configuration.md)                                   |
| Docker networks, Envoy, ingress, egress, OAuth, sessions, TLS                             | [Networking and authentication](docs/networking-and-auth.md)             |
| Git, reconciliation, state, retries, images, deployments, readiness, termination, removal | [Reconciliation and deployments](docs/reconciliation-and-deployments.md) |
| PostgreSQL, RabbitMQ, generated credentials, injected connection variables                | [Managed resources](docs/managed-resources.md)                           |
| Workspace, tooling, scripts, dependencies, verification                                   | [Development](docs/development.md)                                       |

Follow scoped `AGENTS.md` instructions when working in their directories. Read only the additional documents needed for the task.
