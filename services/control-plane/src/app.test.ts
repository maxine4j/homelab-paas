import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { app } from "./app.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "paas-http-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<h1>Hello world</h1>");
  await writeFile(join(directory, "assets/app-123.js"), "console.log('hello')");
  const server = app(directory);
  cleanups.push(() => server.close());
  return server;
}

test("API and static routes retain method, fallback, and cache boundaries", async () => {
  const server = await fixture();
  for (const [method, url, status] of [
    ["GET", "/api/health", 200],
    ["HEAD", "/api/health", 200],
    ["POST", "/api/health", 405],
    ["GET", "/api", 404],
    ["GET", "/api/missing", 404],
    ["GET", "/", 200],
    ["GET", "/services/example", 200],
    ["GET", "/assets/app-123.js", 200],
    ["GET", "/assets/missing.js", 404],
    ["GET", "/missing.js", 404],
    ["POST", "/", 405],
  ] as const) {
    const response = await server.inject({ method, url });
    expect(response.statusCode, `${method} ${url}`).toBe(status);
    if (url.startsWith("/api"))
      expect(response.headers["content-type"] ?? "").not.toContain("text/html");
  }
  expect((await server.inject("/services/example")).body).toContain("Hello world");
  expect((await server.inject("/api/health")).body).toBe("");
  expect((await server.inject("/api/missing")).json()).toEqual({
    code: "not_found",
    diagnostics: [],
  });
  expect((await server.inject("/assets/app-123.js")).headers["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect((await server.inject("/")).headers["cache-control"]).toBe("no-cache");
  expect((await server.inject("/assets/missing.js")).headers["cache-control"]).toBe("no-cache");
});

test("static files cannot escape the UI directory", async () => {
  const server = await fixture();
  for (const url of [
    "/%2e%2e/package.json",
    "/assets/%2e%2e/%2e%2e/package.json",
    "/.env",
    "/assets/missing",
  ]) {
    const response = await server.inject(url);
    expect(response.statusCode).toBe(404);
  }
});
