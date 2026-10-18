import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

const main = new URL("./main.ts", import.meta.url).href;

test.each(["SIGINT", "SIGTERM"] as const)(
  "native TypeScript startup drains on %s",
  async (signal) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(main)})`],
      {
        env: {
          ...process.env,
          PAAS_LISTEN: "127.0.0.1:0",
          PAAS_UI_DIR: tmpdir(),
          LOG_LEVEL: "info",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = once(child, "exit");
    let output = "";
    try {
      for await (const chunk of child.stdout.iterator({ destroyOnReturn: false })) {
        output += String(chunk);
        if (output.includes("Server listening")) break;
      }
      expect(output).toContain("Server listening");
      child.kill(signal);
      expect((await exited).at(0)).toBe(0);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  },
);

test.each([
  'setImmediate(() => { throw new Error("secret-canary") })',
  'void Promise.reject(new Error("secret-canary"))',
  "",
])("fatal failures stop the process without logging rejected values: %s", async (failure) => {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(main)}); ${failure}`],
    {
      env: {
        ...process.env,
        PAAS_LISTEN: failure ? "127.0.0.1:0" : "secret-canary",
        PAAS_UI_DIR: tmpdir(),
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    expect((await exited).at(0)).toBe(1);
    expect(output).toContain("application failed");
    expect(output).not.toContain("secret-canary");
    if (!failure) expect(output).toContain("PAAS_LISTEN");
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
});
