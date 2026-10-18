# Layered architecture

Required for all control-plane backend source changes. These rules define the intended standard; they do not imply existing code fully complies.

## Dependencies and contracts

- Use classes for services, stores, clients, and other components that own behavior and dependencies. Inject collaborators through constructors and type them as interfaces, never concrete implementation classes.
- Define contracts around consumer needs in separate modules: interfaces, domain data types, operation results, and documented errors. Contracts must not import implementations or vendor SDK types. Do not derive interfaces from concrete classes with utilities such as `Pick`.
- Consumers import contracts; implementations implement them. Use `import type` for interfaces and data types, ordinary imports for runtime error classes.
- Exchange primitives, plain objects, arrays, and discriminated unions. Async operations return promises. Keep framework objects, transport metadata, driver values, SDK models, and objects with hidden I/O out of contracts. Plain fields can still leak infrastructure semantics, such as HTTP status codes.
- Inject every side effect or nondeterministic dependency through a contract or small function, including time (`now: () => Date`), UUID generation (`generateUuid: () => string`), randomness, timers, and I/O. Small functions need no wrapper classes. Concrete adapters implement effects; SDK objects remain inside them.
- Do not construct or look up application collaborators inside consumers. No service locators, global dependency registries, or hidden singleton imports. Constructors retain dependencies; resource setup uses explicit async initialization.

## Configuration

A configuration component reads and parses all configuration sources, including environment variables, into validated, typed plain JavaScript values at startup. Missing required values or invalid supplied values must fail startup loudly with actionable errors that do not expose secrets. Only explicitly optional values may be absent; defaults must be deliberate and documented.

Inject the resulting configuration, or the relevant typed subset, into client and service constructors. Consumers must not read `process.env`, parse raw configuration, or supply hidden fallback values. The composition root loads configuration before constructing dependents or accepting work.

## Layer responsibilities

Entry points call service interfaces; services call other service, store, or client interfaces. Concrete adapters access infrastructure.

**HTTP adapters** own methods, paths, headers, cookies, request-shape validation, argument conversion, response mapping, and HTTP status codes. Translate documented domain failures into HTTP responses, centrally where practical. Do not implement business rules or access persistence or external systems directly. Framework request/response objects stay here. Background tasks and other entry points use the same service contracts.

**Services** own business rules, authorization decisions, invariants, workflows, and coordination. Validate business invariants regardless of the entry point. Work with domain values; do not construct URLs, execute storage commands, decode persistence formats, inspect transport status codes, or catch vendor exceptions. Decide what collaborator outcomes mean for the use case, including whether missing data is acceptable.

**Stores and clients** adapt persistence and external systems. They own authentication, connections, commands, serialization, runtime validation, normalization, and infrastructure-error translation. Convert untrusted input into trusted domain values before returning it; assertions do not validate data. Invalid external payloads are adapter failures. Names describe responsibilities, not a required technology.

## Failures and execution semantics

- Define a small, documented set of typed domain errors or explicit operation results for each contract. Describe failures in terms meaningful to the caller, without HTTP status codes or vendor error codes.
- Adapters translate transport, driver, SDK, parsing, and schema failures, including unexpected infrastructure failures, into the contract's supported failures. Handle unsuccessful responses explicitly even when the client library does not throw.
- Map failures using documented external semantics and the operation's meaning. A missing backing file or endpoint may mean broken infrastructure rather than a missing domain resource.
- Keep credentials, raw vendor responses, and internal transport details out of public failures. An underlying cause may be retained for internal diagnostics; callers must not inspect it and entry points must not serialize it. Typed errors are the exception to the plain-value contract rule.
- Document thrown errors: TypeScript promise types do not describe rejection types. Entry points translate domain failures into their own response or task semantics.
- Contract compatibility includes missing values, ordering, consistency, side effects, cancellation, timeouts, and errors. Retries must preserve these guarantees and must not silently duplicate business operations.

## Composition and lifecycle

### `main.ts`: process setup

Keep application knowledge minimal. `main.ts`:

- Creates the application lifecycle.
- Registers `SIGTERM`, `SIGINT`, `uncaughtException`, and `unhandledRejection` handlers.
- Invokes `start(lifecycle)`.
- Logs fatal failures, triggers shutdown, and selects the process exit code.

Fatal handlers are a final boundary, not a substitute for domain error handling or permission to continue after an uncaught fatal error.

### `start.ts`: composition and startup

`start.ts` is the composition root. It selects configuration and concrete implementations, creates clients and stores, injects them into services, builds routers and tasks, registers cleanup, and starts servers or task runners.

Complete required initialization before the corresponding entry point accepts work. Register cleanup as resources are acquired so partial startup can shut down safely.

Concrete construction belongs here; the interface-only rule applies to consumers. Replacing an adapter must require only wiring changes when it honors the same contract. No dependency-injection container, decorators, or runtime interface reflection are needed.

## Verification

- Module mocking is banned for application code. Design and use dependency injection so tests supply collaborators and side effects directly. Mock a third-party module only as an absolute last resort when its integration cannot be tested through an injected adapter or supported test interface; document why the exception is necessary.
- Test services with small interface fakes or in-memory implementations, without networks, persistence systems, or SDK-specific mocks.
- Test adapter mapping, serialization, external-data validation, and failure translation. Run shared behavioral contract tests for interchangeable implementations.
- Test HTTP request conversion, response mapping, and domain-failure translation.

A replacement implementation must leave consumers' imports, calls, data handling, and error handling unchanged. Matching method signatures alone is insufficient.
