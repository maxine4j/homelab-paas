# Reconciliation and deployments

## Deployments

Web and worker resources support:

```yaml
rolloutStrategy: recreate
```

`recreate` is the default.

| Strategy   | Behaviour                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `recreate` | Stop existing containers before starting replacements. Downtime is expected.                              |
| `surge`    | Start replacements alongside existing containers, establish readiness, then retire the previous revision. |

PostgreSQL and RabbitMQ always use recreate deployment.

Surge requires sufficient spare capacity and an application that tolerates overlapping instances. For workers, this includes tolerating concurrent execution across revisions.

### Web rollout sequence

For a surge deployment, the platform:

1. Pulls the required image.
2. Starts replacement containers.
3. Waits for successful readiness checks.
4. Updates Envoy and confirms configuration acceptance.
5. Stops assigning new requests to the previous revision.
6. Drains existing requests within the termination timeout.
7. Stops and removes the previous containers.

If replacement readiness fails, the previous revision remains active.

For recreate deployments, the previous containers are stopped first. A failed replacement is reported and retried; uninterrupted availability is not guaranteed.

### Replicas and load balancing

Web and worker resources may specify `replicas`, defaulting to `1`.

Envoy distributes web traffic across ready replicas. Worker replicas run independently and require application-level coordination where necessary.

A stable service URL remains unchanged as containers are replaced.

## Health checks and termination

Web resources accept:

```yaml
healthcheckUrl: /healthcheck
```

This defaults to `/healthcheck`, relative to the configured application port. HTTP `200–299` indicates readiness.

Health-check timing, startup allowance, and failure thresholds are managed by the platform.

Only ready web containers receive Envoy traffic.

Workers have no configurable readiness check in v1. A running worker container establishes process startup, not application readiness. PostgreSQL and RabbitMQ use platform-managed health checks.

Resources may configure graceful termination:

```yaml
termination:
    timeoutSeconds: 60
```

When omitted, the platform uses its default timeout. Containers receive a graceful stop signal, followed by forced termination if the timeout expires. Web request draining shares this bounded shutdown period.

The platform does not guarantee uninterrupted long-lived streams or connections during deployment.

## Git reconciliation

Each configured repository is checked every configured polling interval.

The platform fetches the configured branch and reads the descriptor from a specific commit. The entire descriptor is validated before changes are applied.

The reconciler must:

- Run at startup, on polling intervals, and after relevant Docker lifecycle events.
- Compare desired configuration with actual managed resources.
- Recover stopped or missing containers.
- Serialize deployments within each service.
- Label Docker objects with service, resource, and revision identities.
- Persist deployment state so interrupted operations can resume safely.
- Retry failed operations with bounded backoff.
- Expose desired revision, active revision, deployment phase, and actionable errors.

Git failures and invalid descriptors preserve the last working deployment.

### Container updates and images

Existing containers should be updated in place where Docker supports the change safely. Changes to images, environment variables, commands, or mounts generally require replacement.

Images are pulled when first creating a resource or deploying a changed image reference. Container creation uses the resolved local image identity.

Periodic detection of changed content behind an unchanged image tag is not required. Image tagging policy belongs to each service.

### Removal

Removing a resource stops and removes its containers. Removing a service stops and removes all its resource containers.

Persistent data and generated credentials are retained.

Reverting the Git change recreates the resource using retained storage and credentials. Compatibility between retained data and the restored image remains the operator’s responsibility.

See [configuration](configuration.md) for descriptor formats and secret resolution, [networking and authentication](networking-and-auth.md) for Envoy boundaries, and [managed resources](managed-resources.md) for retained data and credential rules.
