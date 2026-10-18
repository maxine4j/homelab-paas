import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  Store,
  StoreError,
  decodeSnapshot,
  encodeSnapshot,
  snapshotValidator,
  MAX_GENERATION,
} from "./persistence.ts";
import type { ControllerRecord, Snapshot } from "./persistence.ts";
import { Writer } from "./persistence-writer.ts";
import type { Fault } from "./persistence-writer.ts";

interface Desired {
  resources: string[];
}
const desiredSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resources"],
  properties: {
    resources: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
};
const options = { desiredSchema };
const validate = snapshotValidator<Desired>(desiredSchema);
const reservation = (): ControllerRecord<Desired> => ({
  id: "service-one",
  version: 1,
  generation: 1n,
  data: { kind: "reservation", service_id: "service-one", name: "service-one" },
});
const operation = (): ControllerRecord<Desired> => ({
  id: "op-one",
  version: 1,
  generation: 1n,
  data: {
    kind: "operation",
    service_id: "service-one",
    intent: {
      action: "create",
      target_record_id: "service-one",
      desired_generation: 1n,
      idempotency_key: "operation-one",
    },
    state: { state: "pending" },
  },
});
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "paas-state-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function open(path: string, fresh = false) {
  const store = await Store.open<Desired>(path, "i", "c", fresh, options);
  cleanups.push(() => store.shutdown());
  return store;
}
const statePath = (root: string) => join(root, "_platform/state/controller.yaml");
const code = (value: string) => ({ code: value });

test("durable commits, restart, stale requests and reader isolation", async () => {
  const path = await root();
  let store = await open(path, true);
  expect(store.snapshot().generation).toBe(0n);
  const snapshot = await store.commit(0n, [reservation(), operation()]);
  expect(snapshot.generation).toBe(1n);
  snapshot.records.length = 0;
  expect(store.snapshot().records).toHaveLength(2);
  await expect(store.commit(0n, [])).rejects.toMatchObject(code("stale_generation"));
  await store.shutdown();
  store = await open(path);
  expect(store.snapshot().generation).toBe(1n);
  await expect(store.commit(1n, [reservation(), operation()])).resolves.toMatchObject({
    generation: 2n,
  });
});

test("lifetime lock, installation binding and missing existing state", async () => {
  const path = await root();
  await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(code("recovery_required"));
  const store = await open(path, true);
  await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(code("already_running"));
  await store.shutdown();
  await expect(Store.open(path, "wrong", "c", false)).rejects.toMatchObject(
    code("binding_mismatch"),
  );
  await rm(statePath(path));
  await expect(Store.open(path, "i", "c", true)).rejects.toMatchObject(code("recovery_required"));
});

test("invalid references, duplicate IDs, versions, unknown and secret-bearing fields fail closed", async () => {
  const path = await root();
  const store = await open(path, true);
  for (const records of [[operation()], [reservation(), reservation()]])
    await expect(store.commit(0n, records)).rejects.toMatchObject(code("invalid_snapshot"));
  await expect(store.commit(0n, [{ ...reservation(), version: 9 }])).rejects.toMatchObject(
    code("unsupported_version"),
  );
  const desired: ControllerRecord<Desired> = {
    id: "desired",
    version: 1,
    generation: 1n,
    data: {
      kind: "desired",
      service_id: "service-one",
      revision: "commit",
      digest: "digest",
      snapshot: { resources: [] },
    },
  };
  await expect(store.commit(0n, [reservation(), desired])).rejects.toMatchObject(
    code("invalid_snapshot"),
  );
  desired.data = {
    kind: "desired",
    service_id: "service-one",
    revision: "commit",
    digest: "digest",
    snapshot: { resources: ["web"] },
  };
  await store.commit(0n, [reservation(), desired]);
  await store.shutdown();
  expect(await readFile(statePath(path), "utf8")).toContain("resources:");
  const snapshot = await readFile(statePath(path), "utf8");
  for (const invalid of [
    `${snapshot}\npassword: secret\n`,
    `${snapshot}\ngeneration: 999\n`,
    "[broken",
    snapshot.replace("resources:\n", "password: canary\n        resources:\n"),
  ]) {
    await writeFile(statePath(path), invalid);
    await expect(Store.open(path, "i", "c", false, options)).rejects.toMatchObject(
      code("invalid_snapshot"),
    );
  }
});

test("default store cannot accept desired placeholders", async () => {
  const path = await root();
  const store = await Store.open(path, "i", "c", true);
  try {
    const invalid = {
      ...reservation(),
      data: {
        kind: "desired",
        service_id: "service-one",
        revision: "commit",
        digest: "digest",
        snapshot: { resources: ["web"] },
      },
    };
    // Runtime validation must reject untyped callers too.
    await expect(store.commit(0n, [invalid as ControllerRecord])).rejects.toMatchObject(
      code("invalid_snapshot"),
    );
  } finally {
    await store.shutdown();
  }
});

test("migration preserves a restrictive validated backup and detects conflicts", async () => {
  const path = await root();
  const first = await open(path, true);
  const old = { ...(await first.commit(0n, [reservation(), operation()])), schema_version: 1 };
  await first.shutdown();
  await writeFile(statePath(path), encodeSnapshot(old));
  const store = await open(path);
  expect(store.snapshot()).toEqual({ ...old, schema_version: 2, generation: 2n });
  const backup = join(path, "_platform/state/controller-v1-1.backup.yaml");
  expect(decodeSnapshot(await readFile(backup, "utf8"), validate)).toEqual(old);
  expect((await stat(backup)).mode & 0o777).toBe(0o600);
  await store.shutdown();
  await writeFile(statePath(path), encodeSnapshot(old));
  const recovered = await open(path);
  await recovered.shutdown();
  await writeFile(statePath(path), encodeSnapshot(old));
  await writeFile(backup, "corrupt");
  await expect(Store.open(path, "i", "c", false)).rejects.toBeInstanceOf(StoreError);
  expect(decodeSnapshot(await readFile(statePath(path), "utf8"), validate)).toEqual(old);
});

test.each<Fault>(["write", "file_sync", "rename", "directory_sync", "lost_response"])(
  "interrupted %s recovers only the committed path and halts effects",
  async (fault) => {
    const path = await root();
    const writer = Writer.open<Desired>(path, "i", "c", true, options);
    try {
      writer.fault = fault;
      expect(() => writer.commit(0n, [reservation(), operation()])).toThrow(StoreError);
      expect(writer.current.generation).toBe(0n);
      expect(() => writer.commit(0n, [])).toThrow(expect.objectContaining(code("halted")));
    } finally {
      writer.close();
    }
    const store = await open(path);
    expect(store.snapshot().generation).toBe(
      ["directory_sync", "lost_response"].includes(fault) ? 1n : 0n,
    );
  },
);

test("immutable records, generations, targets, and operation keys", async () => {
  const path = await root();
  const store = await open(path, true);
  await store.commit(0n, [reservation(), operation()]);
  const changed = operation();
  if (changed.data.kind !== "operation") throw new Error("invalid test fixture");
  changed.data.state = { state: "succeeded" };
  await expect(store.commit(1n, [reservation(), changed])).rejects.toMatchObject(
    code("stale_generation"),
  );
  changed.generation = 2n;
  await store.commit(1n, [reservation(), changed]);
  const rebound = structuredClone(changed);
  if (rebound.data.kind !== "operation") throw new Error("invalid test fixture");
  rebound.generation = 3n;
  rebound.data.intent.action = "delete";
  await expect(store.commit(2n, [reservation(), rebound])).rejects.toMatchObject(
    code("invalid_snapshot"),
  );
  await expect(store.commit(2n, [reservation()])).rejects.toMatchObject(code("invalid_snapshot"));
  const duplicate = { ...operation(), id: "op-two" };
  await expect(store.commit(2n, [reservation(), changed, duplicate])).rejects.toMatchObject(
    code("invalid_snapshot"),
  );
});

test("bounded capacity, unsupported versions, symlinks and permissions", async () => {
  const path = await root();
  const store = await open(path, true);
  await expect(store.commit(0n, Array.from({ length: 4097 }, reservation))).rejects.toMatchObject(
    code("capacity"),
  );
  await expect(
    store.commit(0n, [{ ...reservation(), id: "x".repeat(4097) }]),
  ).rejects.toMatchObject(code("capacity"));
  await store.shutdown();
  const original = await readFile(statePath(path), "utf8");
  await writeFile(statePath(path), original.replace("schema_version: 2", "schema_version: 99"));
  await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(
    code("unsupported_version"),
  );
  await rm(statePath(path));
  await symlink(join(path, "outside"), statePath(path));
  await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(code("io"));
  await rm(statePath(path));
  await writeFile(statePath(path), original, { mode: 0o600 });
  await chmod(join(path, "_platform/state"), 0o500);
  await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(code("io"));
  await chmod(join(path, "_platform/state"), 0o700);
});

test("preserves full u64 generations through YAML without numeric rounding", () => {
  const snapshot: Snapshot = {
    schema_version: 2,
    generation: MAX_GENERATION,
    installation_id: "i",
    cluster_id: "c",
    records: [],
  };
  const source = encodeSnapshot(snapshot);
  expect(source).toContain("18446744073709551615");
  expect(decodeSnapshot(source, snapshotValidator())).toEqual(snapshot);
});

test("shared JavaScript references serialize to a standalone restart-safe snapshot", () => {
  const state = { state: "pending" } as const;
  const one = operation();
  const two = operation();
  if (one.data.kind !== "operation" || two.data.kind !== "operation")
    throw new Error("invalid test fixture");
  one.data.state = state;
  two.data.state = state;
  two.id = "op-two";
  two.data.intent.idempotency_key = "operation-two";
  const snapshot: Snapshot<Desired> = {
    schema_version: 2,
    generation: 1n,
    installation_id: "i",
    cluster_id: "c",
    records: [reservation(), one, two],
  };
  const yaml = encodeSnapshot(snapshot);
  expect(yaml).not.toMatch(/&a\d|\*a\d/);
  expect(decodeSnapshot(yaml, validate)).toEqual(snapshot);
});

test("queue capacity, canceled responses and graceful shutdown drain", async () => {
  const path = await root();
  const store = await open(path, true);
  const commits = Array.from({ length: 16 }, (_, index) =>
    store.commit(BigInt(index), [reservation()]),
  );
  await expect(store.commit(16n, [reservation()])).rejects.toMatchObject(code("capacity"));
  const shutdown = store.shutdown();
  await expect(store.commit(16n, [reservation()])).rejects.toMatchObject(code("closed"));
  await Promise.all(commits);
  await shutdown;
  const recovered = await open(path);
  expect(recovered.snapshot().generation).toBe(16n);
});

test("durable write failure closes the runtime effect gate", async () => {
  const path = await root();
  const initial = await open(path, true);
  await initial.shutdown();
  const store = await Store.open<Desired>(path, "i", "c", false, {
    ...options,
    fault: "directory_sync",
  });
  try {
    store.ensureWritable();
    await expect(store.commit(0n, [reservation()])).rejects.toMatchObject(
      code("indeterminate_commit"),
    );
    expect(() => store.ensureWritable()).toThrow(expect.objectContaining(code("halted")));
  } finally {
    await store.shutdown();
  }
});

test("abandoned temporary files are discarded after committed state validates", async () => {
  const path = await root();
  const store = await open(path, true);
  await store.shutdown();
  const abandoned = join(path, "_platform/state/.controller-crashed.tmp");
  await writeFile(abandoned, "partial snapshot", { mode: 0o600 });
  const reopened = await open(path);
  expect(reopened.snapshot().generation).toBe(0n);
  await expect(stat(abandoned)).rejects.toMatchObject({ code: "ENOENT" });
});

test("directory handles stay anchored if a parent is renamed and replaced", async () => {
  const path = await root();
  const writer = Writer.open<Desired>(path, "i", "c", true, options);
  try {
    await rename(join(path, "_platform"), join(path, "saved"));
    await symlink(join(path, "elsewhere"), join(path, "_platform"));
    writer.commit(0n, [reservation()]);
    expect(
      decodeSnapshot(await readFile(join(path, "saved/state/controller.yaml"), "utf8"), validate)
        .generation,
    ).toBe(1n);
    await expect(stat(join(path, "elsewhere"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    writer.close();
  }
});

test("another process is excluded and a crash releases the OS lock", async () => {
  const path = await root();
  const module = new URL("./persistence.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { Store } from ${JSON.stringify(module)};
    await Store.open(${JSON.stringify(path)}, "i", "c", true);
    process.stdout.write("locked\\n");
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  try {
    const ready = await Promise.race([
      once(child.stdout, "data"),
      exited.then(() => {
        throw new Error("lock helper exited before acquiring lock");
      }),
    ]);
    expect(String(ready.at(0))).toContain("locked");
    await expect(Store.open(path, "i", "c", false)).rejects.toMatchObject(code("already_running"));
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
  const store = await open(path);
  expect(store.snapshot().installation_id).toBe("i");
}, 15_000);
