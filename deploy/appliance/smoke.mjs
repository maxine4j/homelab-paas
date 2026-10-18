// Run explicitly inside the packaged Linux image, with /tmp as a writable tmpfs.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { app } from "/opt/homelab-paas/dist/app.js";
import { Store } from "/opt/homelab-paas/dist/persistence.js";

const deadline = setTimeout(() => {
  throw new Error("packaged runtime smoke test timed out");
}, 15_000);
deadline.unref();

const processServer = spawn(process.execPath, ["dist/main.js"], {
  cwd: "/opt/homelab-paas",
  env: { ...process.env, PAAS_LISTEN: "127.0.0.1:0" },
  stdio: ["ignore", "pipe", "inherit"],
});
const exited = once(processServer, "exit");
const lines = createInterface({ input: processServer.stdout });
try {
  let address;
  for await (const line of lines) {
    const match = /http:\/\/127\.0\.0\.1:\d+/.exec(line);
    if (match) {
      address = match.at(0);
      break;
    }
  }
  assert.ok(address, "packaged listener must start");
  assert.equal((await fetch(`${address}/api/health`)).status, 200);
  processServer.kill("SIGTERM");
  assert.equal((await exited).at(0), 0, "SIGTERM must drain and exit cleanly");
} finally {
  lines.close();
  processServer.kill("SIGKILL");
  await exited;
}

const server = app("/usr/share/homelab-paas/ui");
try {
  assert.equal((await server.inject("/api/health")).statusCode, 200);
  assert.equal((await server.inject("/services/example")).statusCode, 200);
  assert.deepEqual((await server.inject("/api/missing")).json(), {
    code: "not_found",
    diagnostics: [],
  });
  assert.match((await server.inject("/")).body, /\/assets\//);
} finally {
  await server.close();
}

const root = await mkdtemp("/tmp/paas-smoke-");
let store;
try {
  store = await Store.open(root, "smoke-install", "smoke-cluster", true);
  await assert.rejects(Store.open(root, "smoke-install", "smoke-cluster", false), {
    code: "already_running",
  });
  const committed = await store.commit(0n, [
    {
      id: "service",
      version: 1,
      generation: 1n,
      data: { kind: "reservation", service_id: "service", name: "service" },
    },
  ]);
  await store.shutdown();
  store = undefined;
  assert.match(await readFile(`${root}/_platform/state/controller.yaml`, "utf8"), /generation: 1/);
  store = await Store.open(root, "smoke-install", "smoke-cluster", false);
  assert.deepEqual(store.snapshot(), committed);
} finally {
  if (store) await store.shutdown();
  await rm(root, { recursive: true, force: true });
}
console.log("Packaged HTTP routes and Linux persistence smoke test passed.");
