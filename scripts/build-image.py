#!/usr/bin/env python3
"""Assemble a Linux OCI image without loading or publishing it."""

import argparse
import platform
from dev import require, run

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--arch", choices=["arm64", "amd64"],
                    default="arm64" if platform.machine() in ("arm64", "aarch64") else "amd64")
args = parser.parse_args()
require("bazel")
run("bazel", "build", f"--config=linux-{args.arch}", "//deploy/appliance:image")
print("Image assembled. Run ./scripts/dev-deploy.py to load and deploy it locally.")
