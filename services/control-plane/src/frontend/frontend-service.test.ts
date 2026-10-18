import { expect, test } from "vitest";
import { FrontendService } from "./frontend-service.ts";
import { UiUnavailableError } from "./frontend-service.ts";

test("navigation falls back only when no static file exists", async () => {
  const paths: string[] = [];
  const service = new FrontendService({
    async inspect(path) {
      paths.push(path);
      return path === "status" ? "file" : "missing";
    },
  });
  expect(await service.resolve("/status")).toEqual({ kind: "file", path: "status" });
  expect(await service.resolve("/services/example")).toEqual({ kind: "file", path: "index.html" });
  expect(await service.resolve("/assets/missing")).toEqual({ kind: "missing" });
  expect(await service.resolve("/missing.js")).toEqual({ kind: "missing" });
  expect(await service.resolve("/.env")).toEqual({ kind: "missing" });
  expect(paths).not.toContain(".env");
});

test("unsafe entries never become navigation fallbacks and failures propagate as domain errors", async () => {
  const blocked = new FrontendService({
    async inspect() {
      return "blocked";
    },
  });
  expect(await blocked.resolve("/linked")).toEqual({ kind: "missing" });
  const unavailable = new FrontendService({
    async inspect() {
      throw new UiUnavailableError();
    },
  });
  await expect(unavailable.resolve("/services")).rejects.toBeInstanceOf(UiUnavailableError);
});
