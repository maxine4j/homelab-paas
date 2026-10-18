#!/usr/bin/env python3
"""Create or reuse the local k3d cluster, then build, import, and deploy the MVP."""

import json
from dev import CLUSTER, IMAGE, ROOT, architecture, kube_environment, require, run

require("bazel", "docker", "k3d", "kubectl")
arch = architecture()
clusters = json.loads(run("k3d", "cluster", "list", "--output", "json", capture=True))
cluster = next((item for item in clusters if item["name"] == CLUSTER), None)
if cluster is None:
    run("k3d", "cluster", "create", CLUSTER,
        "--image", "rancher/k3s:v1.33.6-k3s1",
        "--servers", "1", "--agents", "0",
        "--api-port", "127.0.0.1:6445",
        "--port", "127.0.0.1:8080:30080@loadbalancer",
        "--k3s-arg", "--disable=traefik@server:*",
        "--kubeconfig-update-default=false", "--kubeconfig-switch-context=false",
        "--wait", "--timeout", "120s")
elif not all(node["State"]["Running"] for node in cluster["nodes"]):
    run("k3d", "cluster", "start", CLUSTER, "--wait", "--timeout", "120s")

env = kube_environment()
run("bazel", "run", f"--config=linux-{arch}", "//deploy/appliance:load")
digest = run("docker", "image", "inspect", f"{IMAGE}:dev", "--format", "{{.Id}}", capture=True)
tag = f"{IMAGE}:dev-{digest.removeprefix('sha256:')}"
run("docker", "tag", f"{IMAGE}:dev", tag)
run("k3d", "image", "import", tag, "--cluster", CLUSTER)
manifest = (ROOT / "deploy/kubernetes/local.yaml").read_text().replace("homelab-paas/control-plane:dev", tag)
run("kubectl", "--context", f"k3d-{CLUSTER}", "apply", "-f", "-", stdin=manifest, env=env)
run("kubectl", "--context", f"k3d-{CLUSTER}", "-n", "homelab-paas",
    "rollout", "status", "deployment/control-plane", "--timeout=120s", env=env)
print("Ready: http://127.0.0.1:8080 (health: /api/health)")
