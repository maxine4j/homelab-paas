FROM alpine:3.24.1 AS config
ARG BUILD_SHA=unknown
COPY services/paas-metrics/prometheus.yaml /etc/prometheus/prometheus.yaml
RUN revision=unknown; \
    if echo "$BUILD_SHA" | grep -Eq '^[a-fA-F0-9]{7,40}$'; then revision=$(echo "$BUILD_SHA" | cut -c1-7 | tr 'A-F' 'a-f'); fi; \
    sed -i "s/__BUILD_REVISION__/$revision/g" /etc/prometheus/prometheus.yaml

FROM victoriametrics/victoria-metrics:v1.146.0
COPY --from=config /etc/prometheus/prometheus.yaml /etc/prometheus/prometheus.yaml
CMD ["-storageDataPath=/storage", "-retentionPeriod=30d", "-promscrape.config=/etc/prometheus/prometheus.yaml"]
