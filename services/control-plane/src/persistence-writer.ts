/** Single worker-owned disk writer. Never import this module from HTTP handlers. */
import { constants, fsyncSync, writeSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { AnySchema } from "ajv";
import { closeDescriptor, Directory, openRoot, readBounded, systemCode } from "./posix.ts";
import {
  decodeSnapshot,
  encodeSnapshot,
  MAX_BYTES,
  MAX_GENERATION,
  MAX_RECORDS,
  SCHEMA_VERSION,
  sameIdentity,
  snapshotValidator,
  StoreError,
} from "./persistence-model.ts";
import type { ControllerRecord, Snapshot } from "./persistence-model.ts";

export type Fault = "write" | "file_sync" | "rename" | "directory_sync" | "lost_response";
export interface WriterOptions {
  desiredSchema?: AnySchema;
  fault?: Fault;
}

export class Writer<D = never> {
  current: Snapshot<D>;
  halted = false;
  #directory: Directory;
  #lock: number;
  #sequence = 0;
  #validate: (value: unknown) => Snapshot<D>;
  // Internal fault injection for deterministic commit/recovery tests; not a product setting.
  fault: Fault | undefined;
  private constructor(
    directory: Directory,
    lock: number,
    current: Snapshot<D>,
    validate: (value: unknown) => Snapshot<D>,
    fault?: Fault,
  ) {
    this.#directory = directory;
    this.#lock = lock;
    this.current = current;
    this.#validate = validate;
    this.fault = fault;
  }

  static open<D>(
    rootPath: string,
    installation: string,
    cluster: string,
    fresh: boolean,
    options: WriterOptions = {},
  ): Writer<D> {
    const validate = snapshotValidator<D>(options.desiredSchema);
    const root = openRoot(rootPath);
    let platform: Directory | undefined;
    let directory: Directory | undefined;
    let lock: number | undefined;
    let writer: Writer<D> | undefined;
    try {
      const platformExists = root.entries().includes("_platform");
      if (!platformExists && !fresh) throw new StoreError("recovery_required");
      if (!platformExists && root.entries().length) throw new StoreError("recovery_required");
      platform = root.directory("_platform", !platformExists);
      const stateExists = platform.entries().includes("state");
      if (!stateExists) {
        if (
          !fresh ||
          root.entries().some((name) => name !== "_platform") ||
          platform.entries().some((name) => !["config.yaml", "secrets.yaml"].includes(name))
        )
          throw new StoreError("recovery_required");
      }
      directory = platform.directory("state", !stateExists);
      lock = directory.file("controller.lock", constants.O_RDWR | constants.O_CREAT, "private");
      directory.lock(lock);
      let source: string | undefined;
      try {
        source = readBounded(directory, "controller.yaml", MAX_BYTES, "private");
      } catch (error) {
        if (systemCode(error) !== "ENOENT") throw error;
        if (stateExists || !fresh) throw new StoreError("recovery_required");
      }
      const current =
        source === undefined
          ? validate({
              schema_version: SCHEMA_VERSION,
              generation: 0n,
              installation_id: installation,
              cluster_id: cluster,
              records: [],
            })
          : decodeSnapshot(source, validate);
      if (current.installation_id !== installation || current.cluster_id !== cluster)
        throw new StoreError("binding_mismatch");
      writer = new Writer(directory, lock, current, validate, options.fault);
      if (source === undefined) writer.persist(current);
      if (current.schema_version === 1) {
        const backup = `controller-v1-${current.generation}.backup.yaml`;
        const bytes = encodeSnapshot(current);
        decodeSnapshot(bytes, validate);
        let file: number | undefined;
        try {
          try {
            file = directory.file(
              backup,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
              "private",
            );
            writer.writeComplete(file, Buffer.from(bytes));
          } catch (error) {
            if (systemCode(error) !== "EEXIST") throw error;
            const saved = decodeSnapshot(
              readBounded(directory, backup, MAX_BYTES, "private"),
              validate,
            );
            if (!isDeepStrictEqual(saved, current)) throw new StoreError("recovery_required");
            file = directory.file(backup, constants.O_RDONLY, "private");
          }
          fsyncSync(file);
        } finally {
          if (file !== undefined) closeDescriptor(file);
        }
        directory.sync();
        if (current.generation === MAX_GENERATION) throw new StoreError("capacity");
        const migrated = validate({
          ...current,
          schema_version: SCHEMA_VERSION,
          generation: current.generation + 1n,
        });
        writer.persist(migrated);
        writer.current = migrated;
      }
      for (const name of directory.entries())
        if (name.startsWith(".controller-") && name.endsWith(".tmp")) directory.unlink(name);
      return writer;
    } catch (error) {
      if (lock !== undefined) closeDescriptor(lock);
      directory?.close();
      if (error instanceof StoreError) throw error;
      if (systemCode(error) === "EWOULDBLOCK") throw new StoreError("already_running");
      throw new StoreError("io");
    } finally {
      platform?.close();
      root.close();
    }
  }

  close() {
    closeDescriptor(this.#lock);
    this.#directory.close();
  }
  commit(expected: bigint, records: ControllerRecord<D>[]): Snapshot<D> {
    if (this.halted) throw new StoreError("halted");
    if (this.current.generation !== expected) throw new StoreError("stale_generation");
    if (records.length > MAX_RECORDS || expected === MAX_GENERATION)
      throw new StoreError("capacity");
    const next = this.#validate({ ...this.current, generation: expected + 1n, records });
    const oldRecords = new Map(this.current.records.map((record) => [record.id, record]));
    for (const record of next.records) {
      const old = oldRecords.get(record.id);
      if (old) {
        if (
          !isDeepStrictEqual(old, record) &&
          (old.generation === MAX_GENERATION || record.generation !== old.generation + 1n)
        )
          throw new StoreError("stale_generation");
        if (!sameIdentity(old.data, record.data)) throw new StoreError("invalid_snapshot");
      } else if (record.generation !== 1n) throw new StoreError("stale_generation");
    }
    if (this.current.records.some((old) => !next.records.some((record) => record.id === old.id)))
      throw new StoreError("invalid_snapshot");
    try {
      this.persist(next);
    } catch (error) {
      if (!(error instanceof StoreError) || !["capacity", "invalid_snapshot"].includes(error.code))
        this.halted = true;
      throw error instanceof StoreError ? error : new StoreError("io");
    }
    this.current = structuredClone(next);
    return this.current;
  }

  private writeComplete(file: number, bytes: Buffer) {
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(file, bytes, offset, bytes.length - offset);
      if (written === 0) throw new StoreError("io");
      offset += written;
    }
  }
  private persist(snapshot: Snapshot<D>) {
    const bytes = Buffer.from(encodeSnapshot(snapshot));
    const name = `.controller-${process.pid}-${++this.#sequence}.tmp`;
    let file: number | undefined;
    let renamed = false;
    try {
      file = this.#directory.file(
        name,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        "private",
      );
      this.writeComplete(
        file,
        this.fault === "write" ? bytes.subarray(0, Math.floor(bytes.length / 2)) : bytes,
      );
      if (this.fault === "write" || this.fault === "file_sync") throw new StoreError("io");
      fsyncSync(file);
      if (this.fault === "rename") throw new StoreError("io");
      this.#directory.rename(name, "controller.yaml");
      renamed = true;
      if (this.fault === "directory_sync") throw new StoreError("io");
      this.#directory.sync();
      if (this.fault === "lost_response") throw new StoreError("io");
    } catch (error) {
      if (renamed) {
        this.halted = true;
        throw new StoreError("indeterminate_commit");
      }
      throw error;
    } finally {
      if (file !== undefined) {
        closeDescriptor(file);
        if (!renamed) {
          try {
            this.#directory.unlink(name);
          } catch {
            /* Recovery discards abandoned temporaries. */
          }
        }
      }
    }
  }
}
