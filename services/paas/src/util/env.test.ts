import { expect, test } from "vitest";
import { ConfigError, loadEnv } from "./env.ts";

test("environment defaults and explicit IPv6 listen addresses remain supported", () => {
  expect(loadEnv({})).toEqual({
    listen: { host: "127.0.0.1", port: 8080 },
    uiDirectory: "/usr/share/homelab-paas/ui",
    logLevel: "info",
  });
  expect(loadEnv({ PAAS_LISTEN: "[::1]:0", LOG_LEVEL: "silent", PAAS_UI_DIR: "/tmp/ui" })).toEqual({
    listen: { host: "::1", port: 0 },
    uiDirectory: "/tmp/ui",
    logLevel: "silent",
  });
});

test.each([
  { PAAS_LISTEN: "secret-canary" },
  { PAAS_LISTEN: "localhost:65536" },
  { LOG_LEVEL: "secret-canary" },
  { PAAS_UI_DIR: "" },
  { PAAS_UI_DIR: "\0" },
])("invalid environment settings fail without exposing rejected values: %j", (environment) => {
  expect(() => loadEnv(environment)).toThrow(ConfigError);
  expect(() => loadEnv(environment)).not.toThrow("secret-canary");
});
