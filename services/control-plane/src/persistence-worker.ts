import { parentPort, workerData } from "node:worker_threads";
import { Writer } from "./persistence-writer.ts";
import { StoreError } from "./persistence-model.ts";
import type { ControllerRecord } from "./persistence-model.ts";
import type { WriterOptions } from "./persistence-writer.ts";

interface Options extends WriterOptions {
  root: string;
  installation: string;
  cluster: string;
  fresh: boolean;
}
type Command =
  | { id: number; kind: "commit"; expected: bigint; records: ControllerRecord<unknown>[] }
  | { id: number; kind: "shutdown" };
const port = parentPort;
if (!port) throw new Error("persistence worker requires a parent port");
const options = workerData as Options;
let writer: Writer<unknown> | undefined;
try {
  writer = Writer.open(options.root, options.installation, options.cluster, options.fresh, options);
  port.postMessage({ id: 0, ok: true, snapshot: writer.current });
} catch (error) {
  port.postMessage({
    id: 0,
    ok: false,
    code: error instanceof StoreError ? error.code : "io",
    halted: true,
  });
  port.close();
}
if (writer) {
  const active = writer;
  port.on("message", (command: Command) => {
    try {
      if (command.kind === "shutdown") {
        active.close();
        port.postMessage({ id: command.id, ok: true });
        port.close();
      } else {
        const snapshot = active.commit(command.expected, command.records);
        port.postMessage({ id: command.id, ok: true, snapshot });
      }
    } catch (error) {
      port.postMessage({
        id: command.id,
        ok: false,
        code: error instanceof StoreError ? error.code : "io",
        halted: active.halted,
      });
    }
  });
}
