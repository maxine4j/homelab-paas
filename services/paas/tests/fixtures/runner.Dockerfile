FROM node:24-alpine AS node
FROM docker:28.0.1-dind
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN apk add --no-cache git openssl libstdc++ \
    && ln -s /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY services/paas/package.json services/paas/package.json
COPY services/paas-ui/package.json services/paas-ui/package.json
COPY services/test-service/package.json services/test-service/package.json
COPY packages/shared-contracts/package.json packages/shared-contracts/package.json
COPY packages/backend-infrastructure/package.json packages/backend-infrastructure/package.json
COPY services/forge/package.json services/forge/package.json
COPY services/forge/packages/contracts/package.json services/forge/packages/contracts/package.json
COPY services/forge/packages/frontend/package.json services/forge/packages/frontend/package.json
RUN --mount=type=cache,id=homelab-paas-test-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.json ./
COPY packages/shared-contracts packages/shared-contracts
COPY packages/backend-infrastructure packages/backend-infrastructure
COPY services/forge services/forge
COPY services/paas services/paas
RUN pnpm --filter './packages/*' --filter @homelab-paas/forge-contracts build
