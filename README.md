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
yarn build:docker
```

### Create local config

Copy `config.example.yaml` to `config.local.yaml` and follow the below instructions on aquiring the requird API keys for local testing.

### Setting up DNS in Digital Ocean

Ensure you have a CNAME record pointing to `paas.localhost`

E.g.

```txt
CNAME *paas.local.maxine4j.com paas.localhost
```

You should then update `config.local.yaml` to configure the `paas.rootDomain` and `paas.tls.dnsChallengeProvider.domain` as appropriate. 

E.g.

```yaml
paas:
  rootDomain: paas.local.maxine4j.com
  # ...
  tls:
    dnsChallengeProvider:
      domain: maxine4j.com
      # ...
```

### Setting up GitHub OAuth2 Login

Create a new app at https://github.com/settings/developers
Set the redirect url to point to your DNS record + `/auth/callback`
E.g. `https://paas.local.maxine4j.com/auth/callback`
Update `config.local.yaml` with your `clientId` and `clientSecret`

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