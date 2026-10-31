FROM golang:1.26.4-alpine AS build
WORKDIR /src
ADD --checksum=sha256:13b4186fac9a9d29858c532b73efc41e0a1ac8ce93a615b59d5a6e589e71ab2f https://github.com/influxdata/telegraf/archive/refs/tags/v1.39.3.tar.gz /tmp/telegraf.tar.gz
RUN tar -xzf /tmp/telegraf.tar.gz --strip-components=1 -C /src
# Upstream's supported custom build excludes unused plugins and their startup
# memory overhead. Keep these tags aligned with telegraf.conf.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath \
    -tags "custom,inputs.docker,inputs.docker_log,processors.rename,processors.regex,processors.defaults,outputs.influxdb,outputs.loki,outputs.health,serializers.influx" \
    -ldflags "-s -w -X github.com/influxdata/telegraf/internal.Version=1.39.3" \
    -o /out/telegraf ./cmd/telegraf

FROM alpine:3.24.1
RUN apk add --no-cache ca-certificates
COPY --from=build /out/telegraf /usr/bin/telegraf
COPY services/paas-metrics/telegraf.conf /etc/telegraf/telegraf.conf
# Root is needed for the Docker socket; do not inherit an entrypoint that
# silently drops to an unprivileged user.
ENTRYPOINT ["telegraf"]
CMD ["--config", "/etc/telegraf/telegraf.conf"]
