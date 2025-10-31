# homelab-paas

Simple Platform as a Service for a homelab.

## Features

- Supports single container services with a simple descriptor file
- Zero downtime deployments
- DNS, TLS, and ingress reverse proxy all automatically handled by the paas
- GitHub OAuth login secures services by default, with optional public services

## Local development

### Install dependencies

```
nvm use && yarn
```

### Build test service

```bash
yarn test-service:build
```

### Create GitHub Oauth2 App

See https://github.com/settings/developers
Set redirect url with your CNAME domain: `http://paas.localhost/auth/callback`
Store clientId and clientSecret in .env

### Set .env

```bash
PAAS_AUTH_CLIENT_ID=...
PAAS_AUTH_CLIENT_SECRET=...
PAAS_AUTH_AUTHORIZED_USERS=alice,bob
PAAS_ROOT_DOMAIN=paas.localhost
PAAS_AUTH_JWT_SECRET=...
```

### Run paas

```
yarn paas:dev
```

### Access paas and deployed services

Access the paas via paas.localhost
For any of your deployed services, add the serviceId as an additional subdomain

e.g.
```
paas.localhost
test-service.paas.localhost
```