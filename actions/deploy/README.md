# Deploy Service

Deploys service to your PaaS

## Inputs

- `deploy-token` (required): The deployment token used to authenticate the deployment.
- `service-descriptor-path` (optional): Path to the service descriptor YAML file.
- `api-url` (required): Base URL of your PaaS without trailing slash, e.g. https://paas.example.com

## Example Usage

```yaml
uses: maxine4j/deploy@v1
with:
  deploy-token: ${{ secrets.DEPLOY_TOKEN }}
  service-descriptor-path: ./services/myservice.sd.yaml
  paas-base-url: https://paas.example.com
```
