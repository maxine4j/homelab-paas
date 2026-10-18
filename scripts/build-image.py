#!/usr/bin/env python3
"""Build a Linux image explicitly; export OCI by default, or load for local dev."""

import argparse
import platform
from dev import IMAGE, ROOT, image_builder, require, run

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--arch", choices=["arm64", "amd64"],
                    default="arm64" if platform.machine() in ("arm64", "aarch64") else "amd64")
args = parser.parse_args()
require("docker")
output = ROOT / "artifacts" / f"control-plane-linux-{args.arch}.oci.tar"
output.parent.mkdir(exist_ok=True)
run("docker", "buildx", "build", "--builder", image_builder(), "--platform", f"linux/{args.arch}",
    "--file", "deploy/appliance/Dockerfile", "--tag", f"{IMAGE}:dev",
    "--output", f"type=oci,dest={output}", ".")
print(f"Image assembled: {output}. Use pnpm dev:deploy to load and deploy locally.")
