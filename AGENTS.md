# Homelab PaaS

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is a Platform as a Service (PaaS) for homelabs. The system allows users to deploy single-container services with a simple descriptor file, with automatic handling of DNS, TLS, and ingress reverse proxy. It features zero-downtime deployments and GitHub OAuth login.


### Services

#### paas

- Backend
- Provides APIs to deploy and manage microservices
- Runs as a docker container and utilises the docker socket on the system to run microservices as containers
- Acts as the centralised ingress point for all web traffic
- Acts as TLS termination

#### paas-ui

- Frontend web interface for managing the homelab paas
- Basic CSR react app

#### test-service

- Very basic microservice used to test the paas
- Renders a simple static page
- Responds to healthchecks at /health

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

# Build a specific service
yarn workspace <SERVICE_NAME_HERE> build
```

### Testing
```bash
# Run all tests
yarn test

# Run tests for specific service
yarn workspace <SERVICE_NAME_HERE> build

# Run tests matching a pattern
yarn test ./src/**/*.test.ts
```

### Formatting
```bash
# Format all code
yarn format

# Format specific service
yarn workspace <SERVICE_NAME_HERE> format
```

### Running locally
```bash
# Start development environment with Docker Compose
# This is the priamry way to run the paas locally, it must be running in the conatiner
# This command can be re-run again to rebuild the paas with the latest changes
yarn paas:dev
```

### Testing locally

We can test the paas locally by curling the endpoints, for example to deploy a service
We can then verify the state of things like the deployed applications by curling the paas with the appropriate host header so the reverse proxy forwards the request on to the service

We can also inspect the running containers via the `docker` cli

## Development Methodology

### Strict TDD

All feature work **must** follow the **Red → Green → Refactor** loop:

1. **RED** — Write failing tests first that describe the desired behaviour.
2. Run tests (`yarn test`) — confirm they **fail** (RED).
3. **GREEN** — Write the minimal implementation to make the tests pass.
4. Run tests (`yarn test`) — if still RED, fix the implementation and re-run. Repeat until all tests are **GREEN**.
5. **REFACTOR** — Clean up the code while keeping tests green.
6. Run the full build (`yarn build`) — ensure type-checking and bundling both pass.
7. Repeat for the next feature or behaviour.

#### TDD Rules

- **Never skip the RED step.** Tests must be observed failing before writing implementation code.
- **Never write implementation code without a corresponding test.**
- **Run tests after every change** — do not batch up multiple features before verifying.
- **Keep tests focused and small** — each test should verify one behaviour.
- **The build must pass** (including TypeScript type-checking) before a feature is considered complete.

#### TDD Exceptions

- **TypeScript types and interfaces do NOT need Jest tests.** Type definitions (`type`, `interface`, `enum`) are validated by the TypeScript compiler at build time (`tsc --noEmit`). Do not write Jest tests solely to verify types — the type-checker is the test. Only write tests for runtime behaviour (functions, classes, logic).

### Layered architecture

The backend paas should be developed with good respect for layered architecture. There should be 3 primary layers, datastore > service > api. These layers, and the components within them, should have distinct bounds and not expose implementation details.

Each layer should have well defined contracts, and you should confirm the design of these contracts with me during the planning phase.

## Architecture

### Monorepo Structure

The project uses a monorepo setup with Yarn Workspaces and Turbo for efficient build orchestration.

**Directory Layout:**
- `services/` - Contains all service packages (e.g., `paas`, `paas-ui`, `test-service`)
- Each service is an independent workspace with its own `package.json`
- Root `package.json` defines workspaces: `"services/*"`
- Shared configuration files at root level (tsconfig.json, .prettierrc.json, turbo.json)

**Build System:**
- Uses Turbo for build caching and parallel execution
- `yarn build` runs `turbo build` across all services
- `yarn build:docker` builds Docker images for all services
- `yarn test` runs `turbo test` across all services
- `yarn format` runs `turbo format` across all services

**Service Directory Structure:**
```
services/[service-name]/
├── src/                    # Source TypeScript files
├── dist/                   # Compiled JavaScript output
├── package.json            # Service-specific configuration
├── tsconfig.json           # TypeScript compiler config
├── Dockerfile              # Docker build instructions
├── jest.config.ts          # Jest testing configuration
└── *.sd.yaml               # Service descriptor, this is a descriptor for the microservice. Not applicible to paas and paas-ui
```

**TypeScript Configuration:**
- Root `tsconfig.json` extends `@tsconfig/node20`
- All services can extend this config with `rootDir` and `outDir`
- Uses strict mode with ESNext libraries and CommonJS modules

**Testing:**
- All services use Jest with `ts-jest` preset
- Test environment: `node`
- Test files: `*.test.ts` pattern
- Supertest used for HTTP endpoint testing

### Core Concepts

#### Service Descriptor

Every microservice that we want to deploy into the homelab needs to provide a service descriptor. This descriptor tells paas how to deploy and configure their microservice. These files follow the convention `service-name.sd.yaml`

The primary configuration schema for deployed services:
- `serviceId`: Unique identifier (max 16 chars)
- `image`: Docker image to run
- `networking.ingress`: Container port, public flag, authorized users
- `networking.serviceProxy`: Ingress/egress aliases for mesh networking
- `networking.hostPorts`: Optional port mappings
- `environment`: Environment variables
- `volumes`: Optional volume mounts

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

#### Microservice Deployment Flow
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

#### Frontend Architecture
The project includes a React-based frontend built with Vite for the user interface:

- **Location**: `services/paas-ui/`
- **Framework**: React 19 + TypeScript + Vite 8
- **Port**: 3000
- **Purpose**: User interface for the PaaS

**Access Points**:
- Backend PaaS: Port 80/443 (HTTP/HTTPS via ingress) on `*.rootDomain`
- Frontend UI: Port 3000
- API endpoints: Port 8443

**Key Files**:
- Source: `services/paas-ui/src/` (App.tsx, main.tsx, index.css, etc.)
- Config: `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`
- Docker: `services/paas-ui/Dockerfile`
- Public: `services/paas-ui/public/` (static assets like favicon.svg)
- Build output: `services/paas-ui/dist/` (compiled bundle)

**Implementation Notes**:
- Uses Vite for fast development and building
- Multi-stage Dockerfile following the project's Docker build pattern (base → builder → installer → runner)
- Served by Nginx in production Docker image
- Currently in early development (placeholder implementation)
- Uses Yarn 4.4.0 and Turbo for build orchestration

### Key Patterns

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
- Configuration file location: `paas-config/config.yaml`

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
- AVOID use of any
