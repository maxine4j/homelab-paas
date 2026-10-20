# PaaS agent instructions

- Use the shared `logger` or `createLogger(Component.name)` from [src/util/logger.ts](src/util/logger.ts) directly for logging. This is an explicit exception to the strict dependency injection rule: do not inject the logger through constructors or introduce a logging interface. All other dependencies remain subject to the dependency injection rules. Task tracing is automatic; never pass task context at logging callsites. Log safe operational summaries and identifiers, never raw errors, commands, descriptors or credentials.
