# Build native modules inside the target Linux stage, including cross-builds.
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
COPY packages/shared-contracts/package.json packages/shared-contracts/package.json
COPY services/paas/package.json services/paas/package.json
COPY services/paas-ui/package.json services/paas-ui/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/shared-contracts packages/shared-contracts
COPY services/paas services/paas
COPY services/paas-ui services/paas-ui
RUN pnpm build && pnpm --filter @homelab-paas/paas --prod deploy --legacy /runtime

FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /opt/homelab-paas
COPY --from=build /runtime ./
COPY --from=build /workspace/services/paas-ui/dist /usr/share/homelab-paas/ui
ENV NODE_ENV=production PAAS_LISTEN=0.0.0.0:8080 PAAS_UI_DIR=/usr/share/homelab-paas/ui
USER 65532:65532
EXPOSE 8080
CMD ["node", "dist/main.js"]
