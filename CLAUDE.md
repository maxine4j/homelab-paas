# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Platform as a Service (PaaS) for homelabs. The system allows users to deploy single-container services with a simple descriptor file, with automatic handling of DNS, TLS, and ingress reverse proxy. It features zero-downtime deployments and GitHub OAuth login.

## Development Commands

### Setup
```bash
nvm use && yarn
```

### Building
```bash
# Build all services
yarn build

# Build docker images for all services
yarn build:docker

# Build specific service
cd services/paas
yarn build
```

### Testing
```bash
# Run all tests
yarn test

# Run tests for specific service
cd services/paas
yarn test

# Run tests matching a pattern
yarn test ./src/**/*-test.ts
```

### Formatting
```bash
# Format all code
yarn format

# Format specific service
cd services/paas
yarn format
```

### Running locally
```bash
# Start development environment with Docker Compose
# This is the priamry way to run the paas locally, it must be running in the conatiner
yarn paas:dev
```

### Testing locally

We can test the paas locally by curling the endpoints, for example to deploy a service
We can then verify the state of things like the deployed applications by curling the paas with the appropriate host header so the reverse proxy forwards the request on to the service

We can also inspect the running containers via the `docker` cli

## Architecture

### Monorepo Structure
- Root uses Yarn workspaces with services in `services/`
- Each service has its own package.json with independent builds
- Uses Turbo for build orchestration

### Core Components

#### Task System
The system uses a task-based architecture for background operations:
- **TaskQueue**: In-memory queue for task execution (e.g., deployments)
- **QueueTaskRunner**: Processes queued tasks, running them sequentially
- **PeriodicTaskRunner**: Runs periodic tasks at configured intervals
- **StartupTaskRunner**: Runs one-time tasks on startup

Tasks are defined with a `run()` method and dependencies are injected via constructor. Tasks use the `Lifecycle` utility for graceful shutdown handling.

#### Data Storage
All persistence uses the `KeyValueStore<TValue>` interface:
- **ServiceRepository**: Manages service records in `services.db`
- **DeploymentRepository**: Manages deployment records in `deployments.db`
- **SqliteKeyValueStore**: SQLite-based implementation with database filename and table name configuration

#### Service Deployment Flow
1. Service descriptor validated via Zod schema
2. Deployment task enqueued with unique deploymentId
3. QueueTaskRunner picks up task and executes deploy logic
4. Docker containers are created/updated
5. Networks are configured for service mesh
6. Certificates provisioned for public services

#### Ingress & Routing
Three Koa web servers handle different responsibilities:
1. **Primary PaaS server** (8443): Handles auth, service management, and reverse proxy
2. **HTTP redirect server** (8080): Redirects all HTTP to HTTPS
3. **Service proxy server** (9090): Proxies requests to deployed services

#### TLS Management
- Uses ACME client with DNS-01 challenges for certificate issuance
- Supports multiple DNS challenge providers (Digital Ocean)
- Certificates provisioned once with wildcard support (`*.rootDomain`)
- Periodic renewal task checks and renews certificates before expiration

#### Service Mesh
- Services can reference other services in `serviceProxy.egress` field
- Docker networking with DNS aliases enables inter-service communication
- Network configuration syncs paas container with service networks

### Key Patterns

#### Service Descriptor
The primary configuration schema for deployed services:
- `serviceId`: Unique identifier (max 16 chars)
- `image`: Docker image to run
- `networking.ingress`: Container port, public flag, authorized users
- `networking.serviceProxy`: Ingress/egress aliases for mesh networking
- `networking.hostPorts`: Optional port mappings
- `environment`: Environment variables
- `volumes`: Optional volume mounts

#### Authentication
- GitHub OAuth2 via `AuthService` with provider registry
- JWT tokens for stateless authentication
- Configurable authorized users and admin users
- Optional deploy tokens for CI/CD pipelines

#### Error Handling
- Global error middleware wraps all errors with consistent formatting
- All error paths log via pino logger
- Lifecycle handles SIGTERM/SIGINT and uncaught exceptions gracefully

## Configuration

### Configuration Service
- YAML-based configuration loaded at startup
- Hot-reload task checks for changes every 15 minutes
- Configuration file location: `/etc/homelab-paas/config.yaml`

### Key Configuration Fields
```yaml
paas:
  rootDomain: example.com
  auth:
    jwtSecret: <secret>
    oauth2Provider:
      clientId: <github-client-id>
      clientSecret: <github-secret>
    authorizedUserIds: []
    adminUserIds: []
    deployTokens: []
  tls:
    envType: staging  # or production
    dnsChallengeProvider:
      type: digitalocean
      domain: example.com
      accessToken: <do-token>
```

## Testing

All services use Jest with ts-jest:
- Tests located in `src/**/*-test.ts` or `src/**/*.test.ts`
- Supertest used for HTTP endpoint testing
- Tests run with `yarn test` in each service

## Important Notes

- Services must be built before deployment (docker build)
- Use `nvm use` to ensure correct Node version
- All async operations should use lifecycle-aware task runners
- Avoid using external services in tests (use in-memory stores where possible)
- The system is designed for homelab use, not production deployment