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

### Set up ngrok and DNS

Install and set up ngrok by following: https://dashboard.ngrok.com/get-started/setup/macos

Set up a CNAME record in digital ocean pointing `paas.local.YOUR_DOMAIN_HERE` to your ngrok dev domain. Your dev domain can be found in the docs linked above and should be something like `foo.ngrok-free.app`

### Set up config.yaml

The following script can set up a local test config for you. 

```bash
yarn init:config --domain paas.local.YOUR_DOMAIN_HERE --username your-github-username
```

### Create GitHub Oauth2 App

See https://github.com/settings/developers
Set redirect url with your CNAME domain: `http://paas.local.YOUR_DOMAIN_HERE/auth/callback`
Add the clientId and clientSecret to ``config.local.yaml``

### Create DigitalOcean Access Token

Create a personal access token at https://cloud.digitalocean.com/account/api/tokens
Add the token to `config.local.yaml`

### Run paas

```
yarn paas:dev
```

### Access paas and deployed services

Access the paas via https://paas.local.YOUR_DOMAIN_HERE
For any of your deployed services, add the `serviceId` as an additional subdomain

e.g.
```
https://paas.local.YOUR_DOMAIN_HERE
https://test-service.paas.local.YOUR_DOMAIN_HERE
```
