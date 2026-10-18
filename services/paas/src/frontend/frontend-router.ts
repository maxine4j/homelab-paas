import { extname } from "node:path";
import Koa from "koa";
import type { ApiError } from "@homelab-paas/shared-contracts";
import type { Frontend } from "./frontend-service.ts";
import type { Logger } from "../util/logging.ts";
import { UiUnavailableError } from "./frontend-service.ts";

const notFound: ApiError = { code: "not_found", diagnostics: [] };

/** MVP health means process liveness, not cluster readiness. */
export function app(frontend: Frontend, logger?: Logger) {
  const server = new Koa();
  server.silent = true;
  server.use(async (context) => {
    context.set("cache-control", "no-cache");
    let path: string;
    try {
      path = decodeURIComponent(context.url.split("?").at(0) ?? "/");
    } catch {
      context.status = 400;
      context.body = { code: "invalid_request", diagnostics: [] } satisfies ApiError;
      return;
    }
    const read = context.method === "GET" || context.method === "HEAD";
    try {
      if (path === "/api" || path.startsWith("/api/")) {
        if (path === "/api/health" && read) {
          context.body = "";
          context.status = 200;
        } else {
          context.status = path === "/api/health" ? 405 : 404;
          if (context.status === 405) context.set("allow", "GET, HEAD");
          context.body = notFound;
        }
        return;
      }
      if (!read) {
        context.status = 405;
        context.set("allow", "GET, HEAD");
        return;
      }
      const result = await frontend.resolve(path);
      if (result.kind === "missing") {
        context.status = 404;
        return;
      }
      context.body = Buffer.from(result.content);
      context.type = extname(result.path) || "application/octet-stream";
      context.status = 200;
      if (path.startsWith("/assets/"))
        context.set("cache-control", "public, max-age=31536000, immutable");
    } catch (error) {
      logger?.error({ operation: "serve_ui" }, "UI content is unavailable");
      context.status = 500;
      context.body = {
        statusCode: 500,
        error: "Internal Server Error",
        message: error instanceof UiUnavailableError ? error.message : "Internal Server Error",
      };
    } finally {
      logger?.info(
        { operation: "http_request", method: context.method, status: context.status },
        "request completed",
      );
    }
  });
  return server;
}
