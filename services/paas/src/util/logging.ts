import pino from "pino";

export interface Logger {
  info(context: object, message: string): void;
  error(context: object, message: string): void;
}

/** Callers supply safe messages rather than raw exceptions or credential-bearing URLs. */
export function createProcessLogger(level = "info"): Logger {
  return pino({ level, redact: ["authorization", "cookie", "set-cookie"] });
}
