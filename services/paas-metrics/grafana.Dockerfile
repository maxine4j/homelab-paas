FROM grafana/grafana:12.4.5
USER root
# Baked plugins live outside the persistent data mount. Operator-installed
# plugins retain Grafana's normal /var/lib/grafana/plugins location.
RUN grafana cli --pluginsDir /opt/grafana/plugins plugins install victoriametrics-logs-datasource 0.32.0
USER 472
COPY services/paas-metrics/grafana-datasources.yaml /etc/grafana/provisioning/datasources/paas-metrics.yaml
COPY services/paas-metrics/grafana.ini /etc/grafana/grafana.ini
