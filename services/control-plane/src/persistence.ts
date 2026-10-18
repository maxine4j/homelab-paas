import { Worker } from "node:worker_threads";
import { MAX_RECORDS, StoreError } from "./persistence-model.ts";
import type { ControllerRecord, Snapshot, StoreCode } from "./persistence-model.ts";
import type { WriterOptions } from "./persistence-writer.ts";
export * from "./persistence-model.ts";

type Reply<D> =
  | { id: number; ok: true; snapshot?: Snapshot<D> }
  | { id: number; ok: false; code: StoreCode; halted: boolean };
interface Pending<D> {
  resolve: (snapshot?: Snapshot<D>) => void;
  reject: (error: StoreError) => void;
}

/** Serial worker owns the lock, YAML, and disk I/O; callers see committed copies. */
export class Store<D = never> {
  #worker: Worker;
  #current: Snapshot<D> | undefined;
  #pending = new Map<number, Pending<D>>();
  #sequence = 0;
  #halted = false;
  #closing = false;
  #closed = false;
  #exited: Promise<void>;
  #shutdown: Promise<void> | undefined;
  private constructor(worker: Worker) {
    this.#worker = worker;
    worker.on("message", (reply: Reply<D>) => {
      const pending = this.#pending.get(reply.id);
      this.#pending.delete(reply.id);
      if (!reply.ok) {
        this.#halted ||= reply.halted;
        pending?.reject(new StoreError(reply.code));
      } else {
        if (reply.snapshot) this.#current = reply.snapshot;
        pending?.resolve(reply.snapshot);
      }
    });
    this.#exited = new Promise((resolve) => {
      const fail = () => {
        this.#halted = true;
        for (const pending of this.#pending.values()) pending.reject(new StoreError("closed"));
        this.#pending.clear();
      };
      worker.on("error", fail);
      worker.once("exit", () => {
        this.#closed = true;
        fail();
        resolve();
      });
    });
  }
  static async open<D = never>(
    root: string,
    installation: string,
    cluster: string,
    fresh: boolean,
    options: WriterOptions = {},
  ): Promise<Store<D>> {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const worker = new Worker(new URL(`./persistence-worker${extension}`, import.meta.url), {
      execArgv: [],
      workerData: { root, installation, cluster, fresh, ...options },
    });
    const store = new Store<D>(worker);
    try {
      await new Promise<void>((resolve, reject) =>
        store.#pending.set(0, { resolve: () => resolve(), reject }),
      );
      return store;
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  }
  snapshot(): Snapshot<D> {
    if (!this.#current) throw new StoreError("closed");
    return structuredClone(this.#current);
  }
  ensureWritable() {
    if (this.#halted || this.#closing) throw new StoreError("halted");
  }
  commit(expected: bigint, records: ControllerRecord<D>[]): Promise<Snapshot<D>> {
    if (this.#closing) return Promise.reject(new StoreError("closed"));
    if (this.#halted) return Promise.reject(new StoreError("halted"));
    if (this.#pending.size >= 16 || records.length > MAX_RECORDS)
      return Promise.reject(new StoreError("capacity"));
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (snapshot) =>
          snapshot ? resolve(structuredClone(snapshot)) : reject(new StoreError("closed")),
        reject,
      });
      try {
        this.#worker.postMessage({ id, kind: "commit", expected, records });
      } catch {
        this.#pending.delete(id);
        reject(new StoreError("invalid_snapshot"));
      }
    });
  }
  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    if (this.#closed) return Promise.reject(new StoreError("closed"));
    this.#closing = true;
    this.#shutdown = (async () => {
      const id = ++this.#sequence;
      await new Promise<void>((resolve, reject) => {
        this.#pending.set(id, { resolve: () => resolve(), reject });
        this.#worker.postMessage({ id, kind: "shutdown" });
      });
      await this.#exited;
    })();
    return this.#shutdown;
  }
}
