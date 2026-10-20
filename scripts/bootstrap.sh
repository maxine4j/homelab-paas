#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v brew >/dev/null 2>&1; then
  echo 'Install Homebrew from https://brew.sh, then rerun this script.' >&2
  exit 1
fi
brew bundle --file=Brewfile
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix)/bin:$PATH"
pnpm install --frozen-lockfile
echo 'Dependencies installed. Start Docker Desktop, then run pnpm dev:deploy.'
echo 'For development, add the Homebrew node@24/bin directory to your shell PATH.'
