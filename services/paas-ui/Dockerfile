FROM node:22 AS base
WORKDIR /app
RUN corepack enable
RUN yarn global add turbo@2
RUN turbo telemetry disable

FROM base AS builder
COPY . .
RUN turbo prune paas-ui --docker

FROM base AS installer
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml
RUN yarn install --frozen-lockfile
COPY --from=builder /app/out/full/ .
RUN yarn turbo run build --filter=paas-ui

FROM nginx:stable-alpine AS runner
COPY ./services/paas-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/services/paas-ui/dist /usr/share/nginx/html
EXPOSE 3000
