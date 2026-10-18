import { app } from "./app.ts";

export function listenAddress(value: string): { host: string; port: number } {
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value);
  const host = match?.at(1) ?? match?.at(2);
  const port = Number(match?.at(3));
  if (!host || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PAAS_LISTEN must be a host:port or [IPv6]:port address");
  }
  return { host, port };
}

const server = app(process.env.PAAS_UI_DIR ?? "/usr/share/homelab-paas/ui", true);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.log.info({ operation: "shutdown" }, "draining HTTP connections");
  const deadline = setTimeout(() => {
    server.log.warn({ operation: "shutdown" }, "HTTP drain deadline reached");
    server.server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  try {
    await server.close();
  } catch {
    server.log.error({ operation: "shutdown" }, "HTTP shutdown failed");
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  await server.listen(listenAddress(process.env.PAAS_LISTEN ?? "127.0.0.1:8080"));
} catch {
  server.log.error(
    { operation: "serve" },
    "cannot start HTTP listener; check PAAS_LISTEN and socket availability",
  );
  await server.close();
  process.exitCode = 1;
}
