# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Platform as a Service (PaaS) for homelabs. The system allows users to deploy single-container services with a simple descriptor file, with automatic handling of DNS, TLS, and ingress reverse proxy. It features zero-downtime deployments and GitHub OAuth login.

We have the concept of a service descriptor. Every microservice that we want to deploy into the homelab needs to provide a service descriptor. This descriptor tells paas how to deploy and configure their microservice

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

# Build frontend service
cd services/paas-ui
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

The project uses a monorepo setup with Yarn Workspaces and Turbo for efficient build orchestration.

**Directory Layout:**
- `services/` - Contains all service packages (e.g., `paas`, `test-service`)
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
For the frontend UI (React + Vite), see `services/paas-ui/`

**Docker Build Pattern:**
Each service uses a multi-stage Dockerfile:
1. **base**: Node.js 22, enables corepack, adds Turbo 2, disables telemetry
2. **builder**: Copies all files, runs `turbo prune [service-name] --docker`
3. **installer**: Copies pruned files, runs `yarn install --frozen-lockfile`, then `turbo run build --filter=[service-name]`
4. **runner**: Copies node_modules and dist, exposes port, runs the service

**TypeScript Configuration:**
- Root `tsconfig.json` extends `@tsconfig/node20`
- All services can extend this config with `rootDir` and `outDir`
- Uses strict mode with ESNext libraries and CommonJS modules

**Testing:**
- All services use Jest with `ts-jest` preset
- Test environment: `node`
- Test files: `*.test.ts` or `*-test.ts` pattern
- Supertest used for HTTP endpoint testing

**Service Descriptor (.sd.yaml):**
Optional configuration for deployment:
```yaml
{
  "serviceId": "test-service",
  "image": "test-service:latest",
  "networking": {
    "ingress": {
      "containerPort": 8080
    }
  }
}
```

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

#### Frontend Architecture
The project includes a React-based frontend built with Vite for the user interface:

- **Location**: `services/paas-ui/`
- **Framework**: React 19 + TypeScript + Vite 8
- **Port**: 3000 (direct access via Nginx)
- **Purpose**: User interface for the PaaS platform

**Development Commands**:
```bash
# Build the frontend
cd services/paas-ui
yarn build

# Build Docker image for frontend
cd services/paas-ui
yarn build:docker
```

**Access Points**:
- Backend PaaS: Port 80/443 (HTTP/HTTPS via ingress) on `*.rootDomain`
- Frontend UI: Port 3000 (direct access)
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
- Follows same monorepo architecture as backend services
- Uses Yarn 4.4.0 and Turbo for build orchestration

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