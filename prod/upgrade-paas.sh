#!/usr/bin/env bash

# Parse the complete function before doing work when stdin is a pipe.
main() (
    set -euo pipefail
    umask 077

    fail() { printf '%s\n' "$1" >&2; exit 1; }

    [[ $(id -u) == 0 ]] || fail 'Run as root: sudo bash ~/upgrade-paas.sh'
    for tool in git docker mktemp install rm; do
        command -v "$tool" >/dev/null || fail "Required command missing: $tool"
    done
    config_dir=/etc/homelab-paas
    compose_file="$config_dir/docker-compose.yaml"
    [[ -f "$compose_file" ]] || fail 'Existing /etc/homelab-paas/docker-compose.yaml is required.'

    checkout=$(mktemp -d /tmp/homelab-paas-upgrade.XXXXXXXXXX)
    trap 'rm -rf -- "$checkout"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    printf 'Cloning the latest main branch…\n'
    git clone --depth 1 --single-branch --branch main https://github.com/maxine4j/homelab-paas "$checkout"
    revision=$(git -C "$checkout" rev-parse HEAD)
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail 'Could not resolve the main commit SHA.'

    template="$checkout/prod/etc/homelab-paas/docker-compose.yaml"
    image=ghcr.io/maxine4j/homelab-paas
    matches=0
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == "        image: $image:replace-with-release-tag-or-commit-sha" ]]; then
            line="        image: $image:$revision"
            matches=$((matches + 1))
        fi
        printf '%s\n' "$line"
    done < "$template" > "$checkout/docker-compose.yaml"
    [[ "$matches" == 1 ]] || fail 'Expected exactly one control-plane image placeholder in the Compose template.'
    docker compose -f "$checkout/docker-compose.yaml" config --quiet

    printf 'Stopping the current platform…\n'
    docker compose -f "$compose_file" down
    printf 'Installing Compose pinned to %s…\n' "$revision"
    install -m 0600 "$checkout/docker-compose.yaml" "$compose_file"
    printf 'Starting the updated platform…\n'
    docker compose -f "$compose_file" up -d
    printf 'Upgrade started at %s. Verify logs, login, TLS and application routes.\n' "$revision"
)

main "$@"
