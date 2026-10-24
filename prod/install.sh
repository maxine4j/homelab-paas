#!/usr/bin/env bash

# Disable tracing before credentials are read, even when invoked with bash -x.
set +x

# Parse the complete function before doing work when stdin is curl's pipe.
main() (
    set -euo pipefail
    umask 077

    fail() { printf '❌ %s\n' "$1" >&2; exit 1; }

    [[ $(id -u) == 0 ]] || fail 'Run as root: curl -fsSL https://raw.githubusercontent.com/maxine4j/homelab-paas/main/prod/install.sh | sudo bash'
    for tool in git install mkdir rm stty; do
        command -v "$tool" >/dev/null || fail "Required command missing: $tool"
    done
    if command -v python3 >/dev/null; then
        python=python3
    elif command -v python >/dev/null; then
        python=python
    else
        fail 'Install Python (python3 or python) and retry.'
    fi

    config_dir=/etc/homelab-paas
    state_dir=/var/homelab-paas
    [[ ! -e "$config_dir" && ! -L "$config_dir" ]] || fail 'Existing /etc/homelab-paas preserved; edit it directly instead of reinstalling.'
    [[ ! -L "$state_dir" ]] || fail 'Refusing a symlink at /var/homelab-paas.'
    { exec 3<>/dev/tty; } 2>/dev/null || fail 'An interactive terminal is required for configuration and credentials.'
    tty_settings=$(stty -g <&3)
    trap 'stty "$tty_settings" <&3' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    printf '🌐 Configure your platform…\n'
    printf 'Root domain (for example apps.example.com, without scheme or path): ' >&3
    IFS= read -r root_domain <&3 || fail 'Could not read root domain.'
    [[ -n "$root_domain" ]] || fail 'Root domain must not be empty.'
    printf "Admin's GitHub username: " >&3
    IFS= read -r admin_username <&3 || fail "Could not read admin's GitHub username."
    [[ -n "$admin_username" ]] || fail "Admin's GitHub username must not be empty."
    printf 'ACME email: ' >&3
    IFS= read -r acme_email <&3 || fail 'Could not read ACME email.'
    [[ -n "$acme_email" ]] || fail 'ACME email must not be empty.'
    printf '🔗 Register this GitHub OAuth callback: https://auth.%s/auth/callback\n' "$root_domain"

    stty -echo <&3
    printf '🔐 Enter your GitHub OAuth credentials and DigitalOcean token (input is hidden).\n'
    printf 'GitHub client ID: ' >&3
    IFS= read -r -s github_client_id <&3 || fail 'Could not read GitHub client ID.'
    printf '\n' >&3
    [[ -n "$github_client_id" ]] || fail 'GitHub client ID must not be empty.'
    printf 'GitHub client secret: ' >&3
    IFS= read -r -s github_client_secret <&3 || fail 'Could not read GitHub client secret.'
    printf '\n' >&3
    [[ -n "$github_client_secret" ]] || fail 'GitHub client secret must not be empty.'
    printf 'DigitalOcean API token: ' >&3
    IFS= read -r -s digitalocean_token <&3 || fail 'Could not read DigitalOcean API token.'
    printf '\n' >&3
    [[ -n "$digitalocean_token" ]] || fail 'DigitalOcean API token must not be empty.'
    stty "$tty_settings" <&3
    trap - EXIT
    exec 3>&-

    uuid=$("$python" -c 'import uuid; print(uuid.uuid4())')
    checkout=/tmp/homelab-paas-${uuid}
    mkdir -m 0700 "$checkout"
    trap 'rm -rf -- "$checkout"' EXIT
    printf '📥 Cloning the latest main branch…\n'
    git clone --depth 1 --single-branch --branch main https://github.com/maxine4j/homelab-paas "$checkout"
    revision=$(git -C "$checkout" rev-parse HEAD)
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail 'Could not resolve the main commit SHA.'
    templates="$checkout/prod/etc/homelab-paas"

    printf '🔑 Generating the JWT session signing key…\n'
    signing_key=$("$python" -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
    printf '📝 Preparing configuration and pinning image to %s…\n' "$revision"
    # Credentials travel through stdin, never process arguments or exported env.
    # JSON string scalars are also valid YAML and preserve quotes/backslashes.
    printf '%s\n' "$github_client_id" "$github_client_secret" "$signing_key" "$root_domain" "$admin_username" "$acme_email" "$digitalocean_token" | "$python" -c '
import io, json, os, re, sys
directory, revision = sys.argv[1:]
values = [line.rstrip("\n") for line in sys.stdin]
replacements = {
    "replace-with-github-client-id": json.dumps(values[0]),
    "replace-with-github-client-secret": json.dumps(values[1]),
    "replace-with-a-random-secret-of-at-least-32-characters": json.dumps(values[2]),
    "apps.example.com": json.dumps(values[3]),
    "replace-with-github-username": json.dumps(values[4]),
    "admin@example.com": json.dumps(values[5]),
    "replace-with-digitalocean-api-token": json.dumps(values[6]),
}
for name in ("config.yaml", "docker-compose.yaml"):
    path = os.path.join(directory, name)
    with io.open(path, encoding="utf-8") as source:
        text = source.read()
    if name == "config.yaml":
        pattern = "|".join(re.escape(key) for key in replacements)
        text = re.sub(pattern, lambda match: replacements[match.group(0)], text)
    else:
        text = text.replace("replace-with-release-tag-or-commit-sha", revision)
    with io.open(path, "w", encoding="utf-8") as destination:
        destination.write(text)
' "$templates" "$revision"
    unset github_client_id github_client_secret signing_key digitalocean_token

    printf '📁 Creating private host directories and installing configuration…\n'
    # mkdir is exclusive: a concurrent/repeated installer cannot overwrite files.
    mkdir -m 0700 "$config_dir"
    install -d -m 0700 "$config_dir/env" "$state_dir"
    for name in config.yaml docker-compose.yaml envoy.yaml; do
        install -m 0600 "$templates/$name" "$config_dir/$name"
    done
    printf '✅ Configuration installed. No containers have been started.\n'
    printf '✏️  Edit /etc/homelab-paas/config.yaml (for example: sudo nano /etc/homelab-paas/config.yaml).\n'
    printf '   Add only your service configurations under services; platform settings are ready.\n'
    printf '🚀 Then follow https://github.com/maxine4j/homelab-paas/blob/main/prod/README.md#start-and-verify\n'
    printf '   The pinned main image may still be publishing in CI; wait for it before pulling.\n'
)

main "$@"
