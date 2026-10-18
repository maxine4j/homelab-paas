import type { Middleware } from "koa";
import type { ApiError } from "@homelab-paas/shared-contracts";
import type { Logger } from "./logging.ts";

export function httpMiddleware(logger?: Logger): Middleware {
  return async (context, next) => {
    context.set("cache-control", "no-cache");
    try {
      context.path = decodeURIComponent(context.url.split("?").at(0) ?? "/");
    } catch {
      context.status = 400;
      context.body = { code: "invalid_request", diagnostics: [] } satisfies ApiError;
      return;
    }
    try {
      await next();
    } finally {
      logger?.info(
        { operation: "http_request", method: context.method, status: context.status },
        "request completed",
      );
    }
  };
}
