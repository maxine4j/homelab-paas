import { expect, it, vi } from "vitest";
import { TlsCertRenewalTask } from "./cert-renewal-task.ts";

const logger = { info() {}, error() {} };
const now = new Date("2026-10-18T00:00:00Z");
const current = { key: "old-key", cert: "old-cert" };
const renewed = { key: "new-key", cert: "new-cert" };

function setup(daysRemaining: number, existing: typeof current | undefined = current) {
  const calls: string[] = [];
  const provisionCert = vi.fn(async () => {
    calls.push("provision");
    return renewed;
  });
  const save = vi.fn(async () => {
    calls.push("save");
  });
  const activate = vi.fn(async () => {
    calls.push("activate");
  });
  const task = new TlsCertRenewalTask(
    { provisionCert },
    { load: async () => existing, save },
    { activate },
    {
      inspect: (bundle) => ({
        validFrom: new Date("2026-01-01"),
        validTo: new Date(now.getTime() + (bundle === renewed ? 90 : daysRemaining) * 86400000),
      }),
    },
    () => now,
    logger,
  );
  return { task, calls, provisionCert, save, activate };
}

it("activates an existing valid certificate without renewing early", async () => {
  const { task, provisionCert, activate } = setup(30);
  await task.run();
  expect(activate).toHaveBeenCalledWith(current);
  expect(provisionCert).not.toHaveBeenCalled();
});

it("renews within 30 days and saves the key/chain together before activation", async () => {
  const { task, calls, save, activate } = setup(29);
  await task.run();
  expect(calls).toEqual(["activate", "provision", "save", "activate"]);
  expect(save).toHaveBeenCalledWith(renewed);
  expect(activate).toHaveBeenLastCalledWith(renewed);
});

it("provisions the first certificate when storage is empty", async () => {
  const calls: string[] = [];
  const emptyTask = new TlsCertRenewalTask(
    { provisionCert: async () => renewed },
    {
      load: async () => undefined,
      save: async () => {
        calls.push("save");
      },
    },
    {
      activate: async () => {
        calls.push("activate");
      },
    },
    { inspect: () => ({ validFrom: new Date("2026-01-01"), validTo: new Date("2027-01-01") }) },
    () => now,
    logger,
  );
  await emptyTask.run();
  expect(calls).toEqual(["save", "activate"]);
});

it("keeps the active certificate when issuance or durable saving fails", async () => {
  const first = setup(2);
  first.provisionCert.mockRejectedValue(new Error("issuance failed"));
  await expect(first.task.run()).rejects.toThrow("issuance failed");
  expect(first.activate).toHaveBeenCalledTimes(1);
  const second = setup(2);
  second.save.mockRejectedValue(new Error("disk full"));
  await expect(second.task.run()).rejects.toThrow("disk full");
  expect(second.activate).toHaveBeenCalledTimes(1);
});

it("does not activate expired existing material or save an invalid replacement", async () => {
  const { task, activate, save, provisionCert } = setup(-1);
  provisionCert.mockResolvedValue(current);
  await expect(task.run()).rejects.toThrow("Certificate is not currently valid");
  expect(activate).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("serializes overlapping task runs", async () => {
  const { task, provisionCert } = setup(2);
  await Promise.all([task.run(), task.run()]);
  expect(provisionCert).toHaveBeenCalledTimes(1);
});

it("stops before loading or provisioning when shutdown is requested", async () => {
  const load = vi.fn(async () => current);
  const provisionCert = vi.fn(async () => renewed);
  const task = new TlsCertRenewalTask(
    { provisionCert },
    { load, save: async () => {} },
    { activate: async () => {} },
    { inspect: () => ({ validFrom: now, validTo: now }) },
    () => now,
    logger,
    AbortSignal.abort(),
  );
  await expect(task.run()).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
  expect(provisionCert).not.toHaveBeenCalled();
});
