import { Worker } from "node:worker_threads";
import { ThreadChannel } from "./controller/thread-channel.ts";
import { WorkerControllerStore } from "./controller/controller-store.ts";
import type { ControllerStore } from "./controller/controller-store.ts";
import type { WriterOptions } from "./controller/controller-writer.ts";
import { app } from "./frontend/frontend-router.ts";
import { BootstrapConfig } from "./util/host-config.ts";
import { PosixHostFiles } from "./util/host-files.ts";
import { FrontendService } from "./frontend/frontend-service.ts";
import { DirectoryUiFiles } from "./frontend/frontend-store.ts";
import { loadRuntimeConfig } from "./util/config.ts";
import type { RuntimeConfig } from "./util/config.ts";
import type { ApplicationLifecycle } from "./util/lifecycle.ts";

/** Reusable composition for host configuration; the MVP does not yet expose management. */
export function loadBootstrapConfig(root: string) {
  return new BootstrapConfig(new PosixHostFiles(root)).load();
}

export function createHttpServer(config: RuntimeConfig) {
  const files = new DirectoryUiFiles(config.uiDirectory);
  const frontend = new FrontendService(files);
  return app(frontend, config.uiDirectory, config.logLevel);
}

export async function start(lifecycle: ApplicationLifecycle): Promise<void> {
  const config = loadRuntimeConfig();
  const server = createHttpServer(config);
  lifecycle.add(async () => {
    server.log.info({ operation: "shutdown" }, "draining HTTP connections");
    await server.close();
  });
  await server.listen(config.listen);
}

/** Composition for the worker-owned store; startup must await lock acquisition and recovery. */
export async function openControllerStore<D = never>(
  root: string,
  installation: string,
  cluster: string,
  fresh: boolean,
  options: WriterOptions = {},
): Promise<ControllerStore<D>> {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const worker = new Worker(
    new URL(`./controller/controller-worker${extension}`, import.meta.url),
    {
      execArgv: [],
      workerData: { root, installation, cluster, fresh, ...options },
    },
  );
  const store = new WorkerControllerStore(new ThreadChannel<D>(worker));
  await store.initialize();
  return store;
}
