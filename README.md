# homelab-paas

## Local development

Install `kubectl`, `helm`, and `kind`


## Manually applying infra chart

```bash
helm dependency build charts/ingress/
kustomize build --enable-helm --load-restrictor LoadRestrictionsNone services/paas/src/infra/ingress/ | kubectl apply -f -
```
