FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/test-service/package.json services/test-service/package.json
RUN pnpm install --frozen-lockfile --filter @homelab-paas/test-service
COPY tsconfig.json ./
COPY services/test-service services/test-service
RUN pnpm --filter @homelab-paas/test-service build

FROM build AS runtime
USER node
WORKDIR /app/services/test-service
EXPOSE 8080
CMD ["node", "dist/main.js"]
