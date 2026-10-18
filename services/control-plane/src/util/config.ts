export class ConfigError extends Error {
  readonly path: string;
  readonly problem: string;
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.path = path;
    this.problem = problem;
    this.name = "ConfigError";
  }
}

export interface RuntimeConfig {
  listen: { host: string; port: number };
  uiDirectory: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

/** Deliberate MVP defaults; host bootstrap configuration is loaded separately before management starts. */
export function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfig {
  const value = environment["PAAS_LISTEN"] ?? "127.0.0.1:8080";
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value);
  const host = match?.at(1) ?? match?.at(2);
  const port = Number(match?.at(3));
  if (!host || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new ConfigError("PAAS_LISTEN", "use a host:port or [IPv6]:port address");
  const uiDirectory = environment["PAAS_UI_DIR"] ?? "/usr/share/homelab-paas/ui";
  if (!uiDirectory.trim() || uiDirectory.includes("\0"))
    throw new ConfigError("PAAS_UI_DIR", "provide a non-empty UI directory path");
  const logLevel = environment["LOG_LEVEL"] ?? "info";
  switch (logLevel) {
    case "fatal":
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
    case "silent":
      return { listen: { host, port }, uiDirectory, logLevel };
    default:
      throw new ConfigError("LOG_LEVEL", "use fatal, error, warn, info, debug, trace, or silent");
  }
}

export const MAX_CONFIG_BYTES = 1024 * 1024;
