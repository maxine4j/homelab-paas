import { createServer } from "node:http";
import { once } from "node:events";
import { app } from "./frontend/frontend-router.ts";
import { FrontendService } from "./frontend/frontend-service.ts";
import { DirectoryUiFiles } from "./frontend/frontend-store.ts";
import { loadEnv } from "./util/env.ts";
import type { Env } from "./util/env.ts";
import type { Lifecycle } from "./util/lifecycle.ts";
import { createProcessLogger } from "./util/logging.ts";

export function createHttpServer(config: Env) {
  return app(
    new FrontendService(new DirectoryUiFiles(config.uiDirectory)),
    createProcessLogger(config.logLevel),
  );
}

export async function start(lifecycle: Lifecycle): Promise<void> {
  const config = loadEnv();
  const logger = createProcessLogger(config.logLevel);
  const server = createServer(createHttpServer(config).callback());
  server.requestTimeout = 30_000;
  server.timeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 30_000;
  lifecycle.registerShutdownHandler(async () => {
    logger.info({ operation: "shutdown" }, "draining HTTP connections");
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });
  server.listen(config.listen);
  await once(server, "listening");
  const address = server.address();
  if (address && typeof address !== "string")
    logger.info({ operation: "listen" }, `http://${config.listen.host}:${address.port}`);
}
