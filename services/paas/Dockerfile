FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/paas/package.json services/paas/package.json
COPY services/paas-ui/package.json services/paas-ui/package.json
COPY packages/shared-contracts/package.json packages/shared-contracts/package.json

FROM manifests AS builder
RUN --mount=type=cache,id=homelab-paas-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @homelab-paas/paas... --filter @homelab-paas/ui... --store-dir /pnpm/store
COPY tsconfig.json ./
COPY packages/shared-contracts packages/shared-contracts
COPY services/paas/tsconfig*.json services/paas/
COPY services/paas/src services/paas/src
COPY services/paas-ui services/paas-ui
ARG BUILD_SHA=unknown
RUN pnpm --filter @homelab-paas/shared-contracts build \
    && pnpm --filter @homelab-paas/paas build \
    && BUILD_SHA="$BUILD_SHA" pnpm --filter @homelab-paas/ui build

FROM manifests AS installer
RUN --mount=type=cache,id=homelab-paas-pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter @homelab-paas/paas... --store-dir /pnpm/store

FROM base AS runner
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
LABEL homelab-paas.revision=$BUILD_SHA
RUN apk add --no-cache git openssh-client
ENV NODE_ENV=production
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/services/paas/package.json services/paas/package.json
COPY --from=installer /app/services/paas/node_modules services/paas/node_modules
COPY --from=installer /app/packages/shared-contracts/package.json packages/shared-contracts/package.json
COPY --from=installer /app/packages/shared-contracts/node_modules packages/shared-contracts/node_modules
COPY --from=builder /app/packages/shared-contracts/dist packages/shared-contracts/dist
COPY --from=builder /app/services/paas/dist services/paas/dist
COPY --from=builder /app/services/paas-ui/dist services/paas-ui/dist
WORKDIR /app/services/paas
EXPOSE 8080
CMD ["node", "dist/main.js"]
