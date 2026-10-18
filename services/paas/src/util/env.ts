import { z } from "zod";

export class ConfigError extends Error {
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = "ConfigError";
  }
}

const levelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
export interface Env {
  listen: { host: string; port: number };
  uiDirectory: string;
  logLevel: z.infer<typeof levelSchema>;
}

/** Host bootstrap is separate; these defaults expose only the MVP shell and liveness. */
export function loadEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Env {
  const value = environment["PAAS_LISTEN"] ?? "127.0.0.1:8080";
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value);
  const host = match?.at(1) ?? match?.at(2);
  const port = Number(match?.at(3));
  if (!host || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new ConfigError("PAAS_LISTEN", "use a host:port or [IPv6]:port address");
  const uiDirectory = environment["PAAS_UI_DIR"] ?? "/usr/share/homelab-paas/ui";
  if (!uiDirectory.trim() || uiDirectory.includes("\0"))
    throw new ConfigError("PAAS_UI_DIR", "provide a non-empty UI directory path");
  const level = levelSchema.safeParse(environment["LOG_LEVEL"] ?? "info");
  if (!level.success)
    throw new ConfigError("LOG_LEVEL", "use fatal, error, warn, info, debug, trace, or silent");
  return { listen: { host, port }, uiDirectory, logLevel: level.data };
}
