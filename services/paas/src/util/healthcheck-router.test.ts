import Koa from "koa";
import { afterEach, expect, test } from "vitest";
import { createHealthcheckRouter } from "./healthcheck-router.ts";
import { startTestApi } from "./test/router.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("healthcheck router serves liveness independently of frontend files", async () => {
  const router = createHealthcheckRouter();
  const server = await startTestApi(new Koa().use(router.routes()));
  cleanups.push(server.close);
  for (const method of ["GET", "HEAD"]) {
    const response = await server.inject({ method, url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  }
  expect((await server.inject("/")).statusCode).toBe(404);
});
