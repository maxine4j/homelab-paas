import Router from "@koa/router";
import type { ApiError } from "@homelab-paas/shared-contracts";

/** MVP health means process liveness, not cluster readiness. */
export function createHealthcheckRouter() {
  const router = new Router({ sensitive: true, strict: true });
  router.get("/api/health", (context) => {
    context.body = "";
    context.status = 200;
  });
  router.all("/api/health", (context) => {
    context.status = 405;
    context.set("allow", "GET, HEAD");
    context.body = { code: "not_found", diagnostics: [] } satisfies ApiError;
  });
  return router;
}
