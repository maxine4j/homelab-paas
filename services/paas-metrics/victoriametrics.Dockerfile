FROM victoriametrics/victoria-metrics:v1.146.0
COPY services/paas-metrics/prometheus.yaml /etc/prometheus/prometheus.yaml
CMD ["-storageDataPath=/storage", "-retentionPeriod=30d", "-promscrape.config=/etc/prometheus/prometheus.yaml"]
