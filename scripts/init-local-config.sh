#!/usr/bin/env bash

ROOT_DOMAIN="local.maxine4j.com"
GITHUB_USERNAME="maxine4j"
while true; do
  case "$1" in
    --domain ) ROOT_DOMAIN="$2"; shift ;;
    --username ) GITHUB_USERNAME="$2"; shift 2 ;;
    -- ) shift; break ;;
    * ) break ;;
  esac
done

LOCAL_CONFIG_FILE="./config.local.yaml"

# copy config from example
cp ./config.example.yaml "$LOCAL_CONFIG_FILE"

# set root domain
yq -i ".paas.rootDomain = \"$ROOT_DOMAIN\"" "$LOCAL_CONFIG_FILE"
yq -i ".paas.auth.authorizedUserIds[0] = \"$GITHUB_USERNAME\"" "$LOCAL_CONFIG_FILE"
yq -i ".paas.auth.adminUserIds[0] = \"$GITHUB_USERNAME\"" "$LOCAL_CONFIG_FILE"
yq -i ".paas.tls.dnsChallengeProvider.domain = \"$ROOT_DOMAIN\"" "$LOCAL_CONFIG_FILE"

# generate secrets
jwt_secret=$(python3 -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
yq -i ".paas.auth.jwtSecret = \"$jwt_secret\"" "$LOCAL_CONFIG_FILE"
