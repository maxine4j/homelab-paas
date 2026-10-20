import { expect, test, vi } from "vitest";

import { TlsCertRenewalTask } from "./cert-renewal-task.ts";

test("provisions missing or expiring certificates and retains current material on renewal failure", async () => {
	const now = new Date("2026-01-01T00:00:00Z");
	const provisionCert = vi.fn(async () => ({ cert: "new-cert", key: "new-key" }));
	const publish = vi.fn(async () => {});
	const read = vi.fn(async (): Promise<{ expiresAt: number } | undefined> => undefined);
	const task = new TlsCertRenewalTask({ provisionCert }, { read, publish }, () => now);
	await task.run();
	expect(publish).toHaveBeenCalledWith({ cert: "new-cert", key: "new-key" });
	read.mockResolvedValue({ expiresAt: now.getTime() + 31 * 86400_000 });
	await task.run();
	expect(provisionCert).toHaveBeenCalledTimes(1);
	read.mockResolvedValue({ expiresAt: now.getTime() + 29 * 86400_000 });
	provisionCert.mockRejectedValue(new Error("SECRET"));
	await expect(task.run()).rejects.toThrow("Certificate renewal failed");
	expect(publish).toHaveBeenCalledTimes(1);
});
