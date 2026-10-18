#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v brew >/dev/null 2>&1; then
  echo 'Install Homebrew from https://brew.sh, then rerun this script.' >&2
  exit 1
fi
brew bundle --file=Brewfile
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix rustup)/bin:$(brew --prefix python@3.13)/libexec/bin:$(brew --prefix)/bin:$PATH"
rustup toolchain install 1.90.0 --profile minimal --component clippy,rustfmt
pnpm --dir services/paas-ui install --frozen-lockfile
bazel version
echo 'Dependencies installed. Start Docker Desktop before running scripts/dev-deploy.py.'
echo 'For language development, add the Homebrew node@22/bin and rustup/bin directories to your shell PATH.'
