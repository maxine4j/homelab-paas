FROM node:20 AS base
WORKDIR /app
RUN corepack enable
RUN yarn global add turbo@2
RUN turbo telemetry disable

FROM base AS builder
COPY . .
RUN turbo prune paas --docker

FROM base AS installer
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml
RUN yarn install --frozen-lockfile
COPY --from=builder /app/out/full/ .
RUN yarn turbo run build --filter=paas

FROM base AS runner
COPY --from=installer --chown=app:app /app/node_modules ./node_modules
COPY --from=installer --chown=app:app /app/services/paas/dist ./
EXPOSE 8080

CMD ["node", "/app/main.js"]
