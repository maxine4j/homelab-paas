# Deploy Service

Deploys service to your PaaS

## Inputs

- `deploy_token` (required): The deployment token used to authenticate the deployment.
- `service_descriptor_path` (optional): Path to the service descriptor YAML file.
- `api_url` (required): Base URL of your PaaS without trailing slash, e.g. https://paas.example.com

## Example Usage

```yaml
uses: maxine4j/deploy@v1
with:
  deploy_token: ${{ secrets.DEPLOY_TOKEN }}
  service_descriptor_path: ./services/myservice.sd.yaml
  paas_base_url: https://paas.example.com
```
