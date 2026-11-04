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

FROM docker/sandbox-templates:codex@sha256:a68b972a59148c6359ade441387159033f6d196d48aef9dda06d2d4bb26eb41e AS runner
USER root
WORKDIR /app
ARG BUILD_SHA=unknown
LABEL homelab-paas.revision=$BUILD_SHA
# Preserve the template's development tools while using Forge's tested Node runtime.
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack && corepack enable
ENV NVM_DIR=/opt/nvm
ENV NPM_CONFIG_PREFIX=""
RUN git clone --depth 1 --branch v0.40.8 https://github.com/nvm-sh/nvm.git "$NVM_DIR" && rm -rf "$NVM_DIR/.git"
RUN /bin/bash -c '. "$NVM_DIR/nvm.sh" && nvm install 24.22.0 && nvm alias default 24.22.0' && chown -R agent:agent "$NVM_DIR"
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
RUN mkdir -p /data && chown agent:agent /data && chmod 0700 /data
WORKDIR /app/services/forge
ENV PATH="/app/services/forge/node_modules/.bin:/usr/local/bin:${PATH}"
USER agent
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
