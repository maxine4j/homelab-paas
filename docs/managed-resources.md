# Managed resources

## Managed PostgreSQL and RabbitMQ

PostgreSQL and RabbitMQ are simple container presets with explicit image versions.

The platform automatically:

- Creates persistent storage under the resource directory.
- Generates administrator credentials on first creation.
- Stores credentials in the resource’s `credentials.env` file.
- Configures the database or broker container.
- Injects connection variables into every web and worker container within the service.
- Performs resource-specific health checks.

Descriptors do not accept custom credentials or volumes for these resource types in v1.

Credentials are generated once and reused across reconciliation, replacement, and removal/recreation. Missing credentials alongside existing data must fail deployment rather than silently generating replacements.

### Injected connection variables

For a PostgreSQL resource named `store`:

```dotenv
PAAS_RESOURCE_STORE_HOST=store
PAAS_RESOURCE_STORE_PORT=5432
PAAS_RESOURCE_STORE_DATABASE=example
PAAS_RESOURCE_STORE_USERNAME=<generated>
PAAS_RESOURCE_STORE_PASSWORD=<generated>
```

The initial database name is derived deterministically from the service ID.

For a RabbitMQ resource named `queue`:

```dotenv
PAAS_RESOURCE_QUEUE_HOST=queue
PAAS_RESOURCE_QUEUE_PORT=5672
PAAS_RESOURCE_QUEUE_USERNAME=<generated>
PAAS_RESOURCE_QUEUE_PASSWORD=<generated>
```

Applications must consume these variables or map them to their own configuration.

These presets do not provide backups, replication, automatic credential rotation, or automated major-version upgrades.

See [architecture](architecture.md) for storage paths, [configuration](configuration.md) for descriptor examples and limits, and [reconciliation and deployments](reconciliation-and-deployments.md) for deployment and removal behaviour.
