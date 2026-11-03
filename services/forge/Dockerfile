FROM node:24.22.0-trixie-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/backend-infrastructure/package.json packages/backend-infrastructure/package.json
COPY services/forge/package.json services/forge/package.json
COPY services/forge/packages/contracts/package.json services/forge/packages/contracts/package.json
COPY services/forge/packages/frontend/package.json services/forge/packages/frontend/package.json

FROM manifests AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3=3.13.5-1 make=4.4.1-2 g++=4:14.2.0-1 && rm -rf /var/lib/apt/lists/*
ENV npm_config_build_from_source=true
RUN --mount=type=cache,id=forge-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @homelab-paas/forge... --filter @homelab-paas/forge-ui... --store-dir /pnpm/store
COPY tsconfig.json ./
COPY packages/backend-infrastructure packages/backend-infrastructure
COPY services/forge services/forge
RUN pnpm --filter @homelab-paas/backend-infrastructure build && pnpm --filter @homelab-paas/forge-contracts build && pnpm --filter @homelab-paas/forge build && pnpm --filter @homelab-paas/forge-ui build

FROM manifests AS installer
RUN apt-get update && apt-get install -y --no-install-recommends python3=3.13.5-1 make=4.4.1-2 g++=4:14.2.0-1 && rm -rf /var/lib/apt/lists/*
ENV npm_config_build_from_source=true
RUN --mount=type=cache,id=forge-pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --filter @homelab-paas/forge... --store-dir /pnpm/store

FROM base AS runner
ARG BUILD_SHA=unknown
LABEL homelab-paas.revision=$BUILD_SHA
RUN apt-get update && apt-get install -y --no-install-recommends git=1:2.47.3-0+deb13u1 gh=2.46.0-3 tini=0.19.0-3+b8 ca-certificates=20250419+deb13u1 curl=8.14.1-2+deb13u7 && rm -rf /var/lib/apt/lists/*
ENV NVM_DIR=/opt/nvm
RUN git clone --depth 1 --branch v0.40.8 https://github.com/nvm-sh/nvm.git "$NVM_DIR" && rm -rf "$NVM_DIR/.git"
RUN /bin/bash -c '. "$NVM_DIR/nvm.sh" && nvm install 24.22.0 && nvm alias default 24.22.0' && chown -R node:node "$NVM_DIR"
COPY services/forge/nvm-profile.sh /etc/profile.d/forge-nvm.sh
ENV NODE_ENV=production
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/packages/backend-infrastructure/package.json packages/backend-infrastructure/package.json
COPY --from=installer /app/packages/backend-infrastructure/node_modules packages/backend-infrastructure/node_modules
COPY --from=builder /app/packages/backend-infrastructure/dist packages/backend-infrastructure/dist
COPY --from=installer /app/services/forge/package.json services/forge/package.json
COPY --from=installer /app/services/forge/node_modules services/forge/node_modules
COPY --from=installer /app/services/forge/packages/contracts/package.json services/forge/packages/contracts/package.json
COPY --from=installer /app/services/forge/packages/contracts/node_modules services/forge/packages/contracts/node_modules
COPY --from=builder /app/services/forge/packages/contracts/dist services/forge/packages/contracts/dist
COPY --from=builder /app/services/forge/packages/frontend/dist services/forge/packages/frontend/dist
COPY --from=builder /app/services/forge/dist services/forge/dist
RUN mkdir /data && chown node:node /data && chmod 0700 /data
WORKDIR /app/services/forge
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
