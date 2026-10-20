---
name: typescript-standards
description: Apply repository TypeScript conventions when writing, refactoring, or reviewing TypeScript files, especially backend classes, interfaces, module types, dependency injection, and tests.
---

# TypeScript standards

Apply these conventions within the requested scope. Follow applicable `AGENTS.md` instructions and requirements; existing code may not yet follow every convention below.

## File responsibilities

- Use descriptive kebab-case filenames, such as `artifact-service.ts`. Keep each implementation file focused on one component and its public contract.
- Colocate the exported `IComponent` interface with its implementation in the same file. Declare the interface before the class, and have the class explicitly `implements IComponent`. Consumers import the interface from that file using `import type`.
- Put all shared data types for a module in its `types.ts`: domain interfaces, options, results, aliases, and unions. Never introduce `contracts.ts` or another competing shared-type file. The colocated component interface is the deliberate exception. Keep implementation-only types local rather than exporting them unnecessarily.
- Keep component-specific error classes beside the component; put errors shared across the module in `errors.ts`. Import runtime values such as error classes normally.
- Colocate tests as `<component>.test.ts`. Test public behavior without exposing private implementation details.
- Keep `main.ts` focused on process setup and `start.ts` on composition, initialization, and lifecycle wiring. Put business behavior in separately testable components.
- Import public contracts shared between the backend and UI from `@homelab-paas/shared-contracts`; do not duplicate them in module-local types or import backend implementations into the UI.

## Classes and dependencies

- Use classes for services, stores, and clients that own behavior and dependencies. Define small, caller-oriented interfaces; do not derive them from implementations with `Pick` or similar utilities.
- Inject collaborators and configuration through constructor parameter properties using `private readonly`. Type collaborators by interfaces rather than concrete implementations.
- Constructors retain dependencies. Perform asynchronous setup explicitly during startup. Consumers must not construct collaborators, import application singletons, or read configuration from `process.env`.
- Inject side effects and nondeterminism, including filesystem or network access, clocks, ID generators, and timers. Small effects can be typed functions without wrapper classes.
- Services own domain rules and coordination. Clients and stores own infrastructure access, serialization, external-data validation, and translation of infrastructure failures into supported errors.
- Place explicit class state before the constructor, public methods after it, and private methods last. Mark fields `readonly` unless reassignment is required.
- Prefer private instance methods for implementation helpers, even when they do not use `this`. Do not extract top-level functions or static utilities merely because a helper is stateless. Extract a separate component when it has a distinct responsibility or actual reuse.

## Functions, types, and contracts

- Prefer arrow functions for callbacks, test fixtures, and standalone functions where standalone functions are appropriate. Use normal class method syntax for public and private methods; do not turn every method into an arrow-valued field.
- Use named exports and explicit public method parameter and return types. Async contracts return `Promise<T>`.
- Use `import type` for interfaces and type aliases, with explicit `.ts` extensions for relative TypeScript imports. Keep external imports before local imports and let the repository formatter order them.
- Exchange domain values and plain objects across component interfaces. Keep SDK types, framework request/response objects, and transport details inside adapters.
- Document caller-visible guarantees and failures on interfaces, especially ordering, readiness, partial success, and retry implications. Promise types do not describe rejection types.
- Use proper types instead of `any`. Use `unknown` at untrusted boundaries and validate before use; assertions are not runtime validation. Prefer `satisfies` to check object literals and test fakes without widening their inferred types.
- Prefer `array.at(index)` for indexed element access.
- Keep errors safe for callers. Do not expose credentials, raw infrastructure responses, or sensitive paths.
- Prefer `undefined` to `null`

## Example

Shared module values belong in `types.ts`:

```ts
export interface Artifact {
	id: string;
	content: string;
}
```

A store declares its interface alongside its implementation in `artifact-store.ts`:

```ts
import type { Artifact } from "./types.ts";

export interface IArtifactStore {
	save(artifact: Artifact): Promise<void>;
}

export class InMemoryArtifactStore implements IArtifactStore {
	private readonly artifacts = new Map<string, Artifact>();

	async save(artifact: Artifact): Promise<void> {
		this.artifacts.set(artifact.id, { ...artifact });
	}
}
```

A service consumes that interface in `artifact-service.ts`. The stateless helper stays a private method:

```ts
import type { IArtifactStore } from "./artifact-store.ts";
import type { Artifact } from "./types.ts";

export interface IArtifactService {
	/** Saves a copy with normalized content. Store failures propagate. */
	save(artifact: Artifact): Promise<void>;
}

export class ArtifactService implements IArtifactService {
	constructor(private readonly store: IArtifactStore) {}

	async save(artifact: Artifact): Promise<void> {
		await this.store.save({ ...artifact, content: this.normalizeContent(artifact.content) });
	}

	private normalizeContent(content: string): string {
		return content
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n");
	}
}
```

## Verification

Test behavior with injected interface fakes or in-memory implementations. Use typed `vi.fn` collaborators where useful; do not mock application modules to replace dependencies. Follow the repository's unit-test and TDD requirements, including startup-wiring exceptions. Use existing pnpm, TypeScript, Vitest, and Oxc tooling and the checks appropriate to the change in `docs/development.md`.
