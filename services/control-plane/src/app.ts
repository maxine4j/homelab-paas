import { resolve } from "node:path";
import { lstat } from "node:fs/promises";
import fastify from "fastify";
import staticFiles from "@fastify/static";
import type { ApiError } from "@homelab-paas/shared-contracts";

const notFound: ApiError = { code: "not_found", diagnostics: [] };

/** MVP health means process liveness, not cluster readiness. */
export function app(uiDirectory: string, logging = false) {
  const server = fastify({
    logger: logging
      ? {
          level: process.env.LOG_LEVEL ?? "info",
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
    // Reject traversal and hidden paths before handing a file name to the static plugin.
    if (
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => part.startsWith("."))
    ) {
      return reply.code(404).send();
    }
    const file = path.replace(/^\/+/, "");
    let existing = false;
    let current = resolve(uiDirectory);
    try {
      for (const component of file.split("/").filter(Boolean)) {
        current = resolve(current, component);
        const info = await lstat(current);
        if (info.isSymbolicLink()) return reply.code(404).send();
        existing = info.isFile();
      }
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "ENOTDIR"].includes(String(error.code))
        )
      )
        throw error;
    }
    if (existing) return reply.sendFile(file);
    if (
      path.startsWith("/assets/") ||
      path === "/assets" ||
      path === "/favicon.ico" ||
      path.split("/").at(-1)?.includes(".")
    ) {
      return reply.code(404).send();
    }
    // Static extensionless files take priority over the navigation fallback.
    return reply.sendFile("index.html");
  });
  return server;
}
