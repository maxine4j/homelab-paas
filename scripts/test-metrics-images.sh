#!/bin/sh
# Run against a disposable Engine: never collect the developer host's logs.
set -eu

if [ "${1:-}" != --inner ]; then
    root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
    cd "$root"
    runner="paas-metrics-test-$$"
    cleanup() {
        docker logs "$runner" > "artifacts/$runner-engine.log" 2>&1 || true
        docker rm -fv "$runner" >/dev/null 2>&1 || true
    }
    mkdir -p artifacts
    trap cleanup EXIT
    for component in grafana victoriametrics telegraf; do
        docker build -f "services/paas-metrics/$component.Dockerfile" -t "homelab-paas/metrics-$component:ci" .
    done
    docker pull victoriametrics/victoria-logs:v1.53.0
    docker run -d --privileged --name "$runner" -e DOCKER_TLS_CERTDIR= docker:28.0.1-dind >/dev/null
    ready=false
    for attempt in $(seq 1 60); do
        if docker exec "$runner" docker info >/dev/null 2>&1; then ready=true; break; fi
        sleep 1
    done
    [ "$ready" = true ] || { echo 'Private Engine did not start'; exit 1; }
    docker save homelab-paas/metrics-grafana:ci homelab-paas/metrics-victoriametrics:ci homelab-paas/metrics-telegraf:ci victoriametrics/victoria-logs:v1.53.0 > "artifacts/$runner-images.tar"
    docker exec -i "$runner" docker load < "artifacts/$runner-images.tar"
    rm "artifacts/$runner-images.tar"
    docker cp "$0" "$runner:/test-metrics.sh"
    docker exec "$runner" sh /test-metrics.sh --inner
    exit
fi

diagnostics() {
    for container in grafana victoriametrics victorialogs telegraf fixture; do
        docker logs --tail 80 "$container" 2>&1 || true
    done
}
trap diagnostics EXIT
docker network create --internal metrics >/dev/null
docker network create --internal unrelated >/dev/null
docker run -d --name victoriametrics --network metrics homelab-paas/metrics-victoriametrics:ci >/dev/null
docker run -d --name victorialogs --network metrics victoriametrics/victoria-logs:v1.53.0 -storageDataPath=/storage >/dev/null
# Empty persistent data must not hide the baked plugin.
docker run -d --name grafana --network metrics -v grafana-data:/var/lib/grafana homelab-paas/metrics-grafana:ci >/dev/null
request() { docker exec grafana curl --max-time 5 -fsS "$@"; }
await_contains() {
    expected=$1
    shift
    for attempt in $(seq 1 90); do
        if result=$(request "$@" 2>/dev/null) && { [ -z "$expected" ] || printf '%s' "$result" | grep -Fq "$expected"; }; then return; fi
        sleep 1
    done
    echo "Expected response containing: $expected" >&2
    return 1
}
await_contains 'VictoriaMetrics' http://localhost:3000/api/datasources
await_contains 'VictoriaLogs' http://localhost:3000/api/datasources
await_contains 'victoriametrics-logs-datasource' http://localhost:3000/api/plugins/victoriametrics-logs-datasource/settings
docker run -d --name telegraf --network metrics --memory 128m --cpus 0.1 \
    -v /var/run/docker.sock:/var/run/docker.sock:ro -v telegraf-state:/var/lib/telegraf \
    homelab-paas/metrics-telegraf:ci >/dev/null
await_contains '' http://telegraf:8080
# Start an unlabelled workload later, on a network the collector cannot reach.
docker run -d --name fixture --network unrelated --entrypoint sh homelab-paas/metrics-telegraf:ci \
    -c 'while true; do echo paas-metrics-discovery-marker; sleep 2; done' >/dev/null
await_contains 'fixture' -G http://victoriametrics:8428/api/v1/query \
    --data-urlencode 'query=docker_container_mem_usage{container_name="fixture"}'
await_contains 'paas-metrics-discovery-marker' -G http://victorialogs:9428/select/logsql/query \
    --data-urlencode 'query=container_name:fixture AND "paas-metrics-discovery-marker"'
docker stop telegraf >/dev/null
docker run --rm --entrypoint sh -v telegraf-state:/state homelab-paas/metrics-telegraf:ci \
    -c 'test -s /state/telegraf.state'
docker start telegraf >/dev/null
await_contains '' http://telegraf:8080
await_contains 'paas-metrics-discovery-marker' -G http://victorialogs:9428/select/logsql/query \
    --data-urlencode 'query=container_name:fixture AND "paas-metrics-discovery-marker" AND _time:5s'
docker stats --no-stream telegraf
[ "$(docker inspect telegraf --format '{{.State.OOMKilled}}')" = false ]
echo 'Metrics image smoke checks passed'
