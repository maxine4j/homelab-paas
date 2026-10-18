import { expect, test } from "vitest";
import { ConfigReloadTask } from "./config.ts";

test("config reload task waits for reload and propagates failures", async () => {
  const failure = new Error("reload failed");
  const task = new ConfigReloadTask({
    async reloadConfig() {
      throw failure;
    },
  });
  await expect(task.run()).rejects.toBe(failure);
});
