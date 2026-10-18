import { Ajv } from "ajv";
import type { AnySchema } from "ajv";
import { isDeepStrictEqual } from "node:util";
import { stringify } from "yaml";
import { parseYaml } from "./yaml.ts";

export interface Snapshot<D = never> {
  schema_version: number;
  generation: bigint;
  installation_id: string;
  cluster_id: string;
  records: ControllerRecord<D>[];
}
export interface ControllerRecord<D = never> {
  id: string;
  version: number;
  generation: bigint;
  data: RecordData<D>;
}
export interface ObjectTarget {
  api_group: string;
  resource: string;
  api_version: string;
  kind: string;
  namespace: string | null;
  name: string;
}
export interface OperationIntent {
  action: "create" | "apply" | "delete" | "materialize";
  target_record_id: string;
  desired_generation: bigint;
  idempotency_key: string;
}
export type OperationState =
  | { state: "pending" }
  | { state: "succeeded" }
  | { state: "failed"; code: string };
export type RecordData<D = never> = { service_id: string } & (
  | { kind: "reservation"; name: string }
  | { kind: "approval"; administrator: string; revision: string }
  | { kind: "desired"; revision: string; digest: string; snapshot: D }
  | {
      kind: "inventory";
      target: ObjectTarget;
      ownership_token: string;
      uid: string | null;
      lifecycle: "runtime" | "retained";
    }
  | { kind: "revision"; revision: string; phase: "accepted" | "applied" | "healthy" }
  | { kind: "operation"; intent: OperationIntent; state: OperationState }
);
export type StoreCode =
  | "io"
  | "already_running"
  | "recovery_required"
  | "invalid_snapshot"
  | "unsupported_version"
  | "binding_mismatch"
  | "capacity"
  | "stale_generation"
  | "indeterminate_commit"
  | "halted"
  | "closed";
export class StoreError extends Error {
  readonly code: StoreCode;
  constructor(code: StoreCode) {
    super(`controller metadata: ${code}; stop effects and inspect the canonical state directory`);
    this.name = "StoreError";
    this.code = code;
  }
}
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDS = 4096;
export const MAX_GENERATION = (1n << 64n) - 1n;
export const SCHEMA_VERSION = 2;
const uint64 = { uint64: true };
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
function variant(kind: string, properties: Record<string, unknown>) {
  return object({ kind: { const: kind }, service_id: text, ...properties });
}

export function snapshotValidator<D>(desiredSchema: AnySchema = false) {
  const ajv = new Ajv({ strict: true, allowUnionTypes: true });
  ajv.addKeyword({
    keyword: "uint64",
    schemaType: "boolean",
    validate: (_schema: boolean, value: unknown) =>
      typeof value === "bigint" && value >= 0n && value <= MAX_GENERATION,
  });
  const shape = ajv.compile<Snapshot<D>>(
    object({
      schema_version: { type: "integer", minimum: 0, maximum: 0xffff_ffff },
      generation: uint64,
      installation_id: text,
      cluster_id: text,
      records: {
        type: "array",
        maxItems: MAX_RECORDS,
        items: object({
          id: text,
          version: { type: "integer", minimum: 0, maximum: 0xffff_ffff },
          generation: uint64,
          data: {
            oneOf: [
              variant("reservation", { name: text }),
              variant("approval", { administrator: text, revision: text }),
              variant("desired", { revision: text, digest: text, snapshot: desiredSchema }),
              variant("inventory", {
                target: object({
                  api_group: text,
                  resource: text,
                  api_version: text,
                  kind: text,
                  namespace: nullableText,
                  name: text,
                }),
                ownership_token: text,
                uid: nullableText,
                lifecycle: { enum: ["runtime", "retained"] },
              }),
              variant("revision", {
                revision: text,
                phase: { enum: ["accepted", "applied", "healthy"] },
              }),
              variant("operation", {
                intent: object({
                  action: { enum: ["create", "apply", "delete", "materialize"] },
                  target_record_id: text,
                  desired_generation: uint64,
                  idempotency_key: text,
                }),
                state: {
                  oneOf: [
                    object({ state: { const: "pending" } }),
                    object({ state: { const: "succeeded" } }),
                    object({ state: { const: "failed" }, code: text }),
                  ],
                },
              }),
            ],
          },
        }),
      },
    }),
  );
  return (value: unknown): Snapshot<D> => {
    if (!shape(value)) throw new StoreError("invalid_snapshot");
    validateSnapshot(value);
    return value;
  };
}

export function boundedRecords<D>(records: ControllerRecord<D>[]) {
  if (records.length > MAX_RECORDS) throw new StoreError("capacity");
  for (const record of records) {
    let fields: string[] = [record.id, record.data.service_id];
    const data = record.data;
    switch (data.kind) {
      case "reservation":
        fields.push(data.name);
        break;
      case "approval":
        fields.push(data.administrator, data.revision);
        break;
      case "desired":
        fields.push(data.revision, data.digest);
        break;
      case "revision":
        fields.push(data.revision);
        break;
      case "inventory":
        fields = fields.concat(
          Object.values(data.target).filter((value): value is string => value !== null),
          data.ownership_token,
          data.uid === null ? [] : [data.uid],
        );
        break;
      case "operation":
        fields.push(data.intent.target_record_id, data.intent.idempotency_key);
        if (data.state.state === "failed") fields.push(data.state.code);
        break;
    }
    if (
      fields.some((field) => Buffer.byteLength(field) > 4096) ||
      fields.reduce((size, field) => size + Buffer.byteLength(field), 0) > 16 * 1024
    )
      throw new StoreError("capacity");
  }
}

function unique(set: Set<string>, key: string) {
  if (set.has(key)) throw new StoreError("invalid_snapshot");
  set.add(key);
}
export function validateSnapshot<D>(snapshot: Snapshot<D>) {
  if (![1, SCHEMA_VERSION].includes(snapshot.schema_version))
    throw new StoreError("unsupported_version");
  if (!snapshot.installation_id || !snapshot.cluster_id) throw new StoreError("invalid_snapshot");
  boundedRecords(snapshot.records);
  const ids = new Set<string>();
  const services = new Set<string>();
  const names = new Set<string>();
  const targets = new Set<string>();
  const tokens = new Set<string>();
  const keys = new Set<string>();
  for (const record of snapshot.records) {
    if (record.version !== 1) throw new StoreError("unsupported_version");
    if (!record.id || record.generation === 0n) throw new StoreError("invalid_snapshot");
    unique(ids, record.id);
    const data = record.data;
    const fields = [data.service_id];
    switch (data.kind) {
      case "reservation":
        fields.push(data.name);
        if (data.service_id !== record.id) throw new StoreError("invalid_snapshot");
        unique(services, data.service_id);
        unique(names, data.name);
        break;
      case "approval":
        fields.push(data.administrator, data.revision);
        break;
      case "desired":
        fields.push(data.revision, data.digest);
        break;
      case "revision":
        fields.push(data.revision);
        break;
      case "inventory": {
        const target = data.target;
        fields.push(
          target.resource,
          target.api_version,
          target.kind,
          target.name,
          data.ownership_token,
        );
        if (target.namespace !== null) fields.push(target.namespace);
        if (data.uid !== null) fields.push(data.uid);
        unique(
          targets,
          JSON.stringify([
            target.api_group,
            target.resource,
            target.api_version,
            target.kind,
            target.namespace,
            target.name,
          ]),
        );
        unique(tokens, data.ownership_token);
        break;
      }
      case "operation":
        if (data.intent.desired_generation === 0n) throw new StoreError("invalid_snapshot");
        fields.push(data.intent.target_record_id, data.intent.idempotency_key);
        if (data.state.state === "failed") fields.push(data.state.code);
        unique(keys, data.intent.idempotency_key);
        break;
    }
    if (fields.some((field) => !field.trim())) throw new StoreError("invalid_snapshot");
  }
  for (const record of snapshot.records) {
    if (!services.has(record.data.service_id)) throw new StoreError("invalid_snapshot");
    if (record.data.kind === "operation" && !ids.has(record.data.intent.target_record_id))
      throw new StoreError("invalid_snapshot");
  }
}

export function sameIdentity<D>(old: RecordData<D>, next: RecordData<D>): boolean {
  if (old.kind !== next.kind || old.service_id !== next.service_id) return false;
  switch (old.kind) {
    case "reservation":
    case "approval":
      return isDeepStrictEqual(old, next);
    case "desired":
    case "revision":
      return true;
    case "operation":
      return next.kind === "operation" && isDeepStrictEqual(old.intent, next.intent);
    case "inventory":
      return (
        next.kind === "inventory" &&
        isDeepStrictEqual(old.target, next.target) &&
        old.ownership_token === next.ownership_token &&
        old.lifecycle === next.lifecycle &&
        (old.uid === null || old.uid === next.uid)
      );
  }
}
export function encodeSnapshot<D>(snapshot: Snapshot<D>) {
  const source = stringify(snapshot, { lineWidth: 0, aliasDuplicateObjects: false });
  if (Buffer.byteLength(source) > MAX_BYTES) throw new StoreError("capacity");
  return source;
}

// YAML integers must not pass through IEEE-754 before restoring u64 generations.
function normalizeIntegers(value: unknown, path = ""): unknown {
  if (typeof value === "bigint") {
    if (
      /^(generation|records\.\d+\.generation|records\.\d+\.data\.intent\.desired_generation)$/.test(
        path,
      )
    )
      return value;
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new StoreError("invalid_snapshot");
    return number;
  }
  if (Array.isArray(value))
    return value.map((item: unknown, index: number) => normalizeIntegers(item, `${path}.${index}`));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeIntegers(item, path ? `${path}.${key}` : key),
      ]),
    );
  return value;
}
export function decodeSnapshot<D>(
  source: string,
  validate: (value: unknown) => Snapshot<D>,
): Snapshot<D> {
  if (Buffer.byteLength(source) > MAX_BYTES) throw new StoreError("capacity");
  try {
    return validate(normalizeIntegers(parseYaml(source, "controller.yaml", MAX_BYTES, true)));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("invalid_snapshot");
  }
}
