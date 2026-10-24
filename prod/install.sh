#!/usr/bin/env bash

# Disable tracing before credentials are read, even when invoked with bash -x.
set +x

# Parse the complete function before doing work when stdin is curl's pipe.
main() (
    set -euo pipefail
    umask 077

    fail() { printf '❌ %s\n' "$1" >&2; exit 1; }

    [[ $(id -u) == 0 ]] || fail 'Run as root: curl -fsSL https://raw.githubusercontent.com/maxine4j/homelab-paas/refs/heads/main/prod/install.sh | sudo bash'
    for tool in git install mkdir rm stty od tr sed; do
        command -v "$tool" >/dev/null || fail "Required command missing: $tool"
    done

    # JSON double-quoted scalars are valid YAML. Keep secrets in shell memory.
    quote_yaml() {
        local value=$1 character escaped result='"' index
        for ((index = 0; index < ${#value}; index++)); do
            character=${value:index:1}
            case "$character" in
                '\') result+='\\' ;;
                '"') result+='\"' ;;
                [[:cntrl:]])
                    printf -v escaped '\\u%04x' "'$character"
                    result+=$escaped
                    ;;
                *) result+=$character ;;
            esac
        done
        REPLY=$result'"'
    }

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

    random_hex=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    [[ "$random_hex" =~ ^[0-9a-f]{32}$ ]] || fail 'Could not generate a checkout UUID.'
    # UUID v4: reserve the version and variant bits in 16 random bytes.
    printf -v uuid '%s-%s-4%s-%x%s-%s' "${random_hex:0:8}" "${random_hex:8:4}" \
        "${random_hex:13:3}" "$(( (16#${random_hex:16:1} & 3) | 8 ))" \
        "${random_hex:17:3}" "${random_hex:20:12}"
    checkout=/tmp/homelab-paas-${uuid}
    mkdir -m 0700 "$checkout"
    trap 'rm -rf -- "$checkout"' EXIT
    printf '📥 Cloning the latest main branch…\n'
    git clone --depth 1 --single-branch --branch main https://github.com/maxine4j/homelab-paas "$checkout"
    revision=$(git -C "$checkout" rev-parse HEAD)
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail 'Could not resolve the main commit SHA.'
    templates="$checkout/prod/etc/homelab-paas"

    printf '🔑 Generating the JWT session signing key…\n'
    signing_key=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    [[ "$signing_key" =~ ^[0-9a-f]{64}$ ]] || fail 'Could not generate a session signing key.'
    printf '📝 Preparing configuration and pinning image to %s…\n' "$revision"
    placeholders=(replace-with-github-client-id replace-with-github-client-secret
        replace-with-a-random-secret-of-at-least-32-characters apps.example.com
        replace-with-github-username admin@example.com replace-with-digitalocean-api-token)
    values=("$github_client_id" "$github_client_secret" "$signing_key" "$root_domain"
        "$admin_username" "$acme_email" "$digitalocean_token")
    # Match each original template line once; never replace inside inserted values.
    while IFS= read -r line || [[ -n "$line" ]]; do
        for index in "${!placeholders[@]}"; do
            placeholder=${placeholders[index]}
            if [[ "$line" == *"$placeholder"* ]]; then
                quote_yaml "${values[index]}"
                printf -v line '%s%s%s' "${line%%"$placeholder"*}" "$REPLY" "${line#*"$placeholder"}"
                break
            fi
        done
        printf '%s\n' "$line"
    done < "$templates/config.yaml" > "$checkout/config.yaml"
    sed "s/replace-with-release-tag-or-commit-sha/$revision/" \
        "$templates/docker-compose.yaml" > "$checkout/docker-compose.yaml"
    unset github_client_id github_client_secret signing_key digitalocean_token values REPLY line

    printf '📁 Creating private host directories and installing configuration…\n'
    # mkdir is exclusive: a concurrent/repeated installer cannot overwrite files.
    mkdir -m 0700 "$config_dir"
    install -d -m 0700 "$config_dir/env" "$state_dir"
    for name in config.yaml docker-compose.yaml; do
        install -m 0600 "$checkout/$name" "$config_dir/$name"
    done
    install -m 0600 "$templates/envoy.yaml" "$config_dir/envoy.yaml"
    printf '✅ Configuration installed. No containers have been started.\n'
    printf '✏️  Edit /etc/homelab-paas/config.yaml (for example: sudo nano /etc/homelab-paas/config.yaml).\n'
    printf '   Add only your service configurations under services; platform settings are ready.\n'
    printf '🚀 Then follow https://github.com/maxine4j/homelab-paas/blob/main/prod/README.md#start-and-verify\n'
)

main "$@"
