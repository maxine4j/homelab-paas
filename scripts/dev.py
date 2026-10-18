"""Shared local-dev process helpers. All external commands use argument arrays."""

from __future__ import annotations

import os
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "homelab-paas/control-plane"
CLUSTER = "homelab-paas-dev"
BUILDER = "homelab-paas-build"


def run(*args: str, capture: bool = False, stdin: str | None = None,
        env: dict[str, str] | None = None) -> str:
    print("+ " + " ".join(args), file=sys.stderr, flush=True)
    try:
        result = subprocess.run(args, cwd=ROOT, check=True, text=True, input=stdin,
                                stdout=subprocess.PIPE if capture else None, env=env)
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"{args[0]} failed (exit {error.returncode}); see output above.") from error
    return result.stdout.strip() if capture else ""


def require(*commands: str) -> None:
    for command in commands:
        if not shutil.which(command):
            raise SystemExit(f"Missing {command}; run ./scripts/bootstrap.sh first.")


def architecture() -> str:
    value = run("docker", "info", "--format", "{{.Architecture}}", capture=True)
    if value in ("aarch64", "arm64"):
        return "arm64"
    if value in ("x86_64", "amd64"):
        return "amd64"
    raise SystemExit(f"Unsupported Docker architecture: {value}")


def image_builder() -> str:
    """OCI export needs the container driver; preserve the user's default builder."""
    builders = run("docker", "buildx", "ls", "--format", "json", capture=True)
    for line in builders.splitlines():
        builder = json.loads(line)
        if builder["Name"] == BUILDER:
            if builder["Driver"] != "docker-container":
                raise SystemExit(f"Builder {BUILDER} must use the docker-container driver.")
            return BUILDER
    run("docker", "buildx", "create", "--name", BUILDER, "--driver", "docker-container")
    return BUILDER


def kube_environment() -> dict[str, str]:
    state = ROOT / ".dev"
    state.mkdir(mode=0o700, exist_ok=True)
    config = run("k3d", "kubeconfig", "get", CLUSTER, capture=True)
    temporary = state / "kubeconfig.tmp"
    temporary.write_text(config + "\n")
    temporary.chmod(0o600)
    temporary.replace(state / "kubeconfig")
    return {**os.environ, "KUBECONFIG": str(state / "kubeconfig")}
