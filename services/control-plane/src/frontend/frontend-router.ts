import { resolve } from "node:path";
import fastify from "fastify";
import staticFiles from "@fastify/static";
import type { ApiError } from "@homelab-paas/shared-contracts";
import type { Frontend } from "./frontend-service.ts";
import type { RuntimeConfig } from "../util/config.ts";
import { UiUnavailableError } from "./frontend-service.ts";

const notFound: ApiError = { code: "not_found", diagnostics: [] };

/** MVP health means process liveness, not cluster readiness. */
export function app(
  frontend: Frontend,
  uiDirectory: string,
  logLevel: RuntimeConfig["logLevel"] | false = false,
) {
  const server = fastify({
    logger: logLevel
      ? {
          level: logLevel,
          redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
          serializers: {
            // URLs may contain credentials in query parameters; log the path only.
            req: (request) => ({ method: request.method, path: request.url?.split("?").at(0) }),
          },
        }
      : false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 30_000,
    keepAliveTimeout: 5_000,
    forceCloseConnections: "idle",
  });

  server.addHook("onSend", async (request, reply) => {
    const path = request.url.split("?").at(0) ?? "/";
    reply.header(
      "cache-control",
      path.startsWith("/assets/") && reply.statusCode < 300
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
  });
  server.get("/api/health", async (_request, reply) => reply.code(200).send());

  server.register(staticFiles, {
    root: resolve(uiDirectory),
    wildcard: false,
    index: false,
    redirect: false,
    serve: false,
    cacheControl: false,
  });
  server.setNotFoundHandler(async (request, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(request.url.split("?").at(0) ?? "/");
    } catch {
      return reply.code(400).send({ code: "invalid_request", diagnostics: [] } satisfies ApiError);
    }
    if (path === "/api" || path.startsWith("/api/")) {
      if (path === "/api/health")
        return reply.header("allow", "GET, HEAD").code(405).send(notFound);
      return reply.code(404).send(notFound);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.header("allow", "GET, HEAD").code(405).send();
    }
    try {
      const result = await frontend.resolve(path);
      return result.kind === "file" ? reply.sendFile(result.path) : reply.code(404).send();
    } catch (error) {
      if (!(error instanceof UiUnavailableError)) throw error;
      request.log.error({ operation: "serve_ui" }, "UI content is unavailable");
      return reply.code(500).send({
        statusCode: 500,
        error: "Internal Server Error",
        message: "UI content is unavailable",
      });
    }
  });
  return server;
}
