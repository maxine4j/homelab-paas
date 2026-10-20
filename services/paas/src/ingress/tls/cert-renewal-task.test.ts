import { expect, test, vi } from "vitest";

import { captureLogs } from "../../util/test/logs.ts";
import { TlsCertRenewalTask } from "./cert-renewal-task.ts";

test("logs certificate changes without material and keeps an unneeded renewal silent", async () => {
	const capture = captureLogs();
	let expiresAt: number | undefined;
	const task = new TlsCertRenewalTask(
		{
			async provisionCert() {
				return { cert: "SECRET", key: "SECRET" };
			},
		},
		{
			async read() {
				return expiresAt === undefined ? undefined : { expiresAt };
			},
			async publish() {
				expiresAt = 40 * 86400_000;
			},
		},
		() => new Date(0),
	);
	try {
		await task.run();
		await task.run();
	} finally {
		capture.restore();
	}
	expect(capture.lines.map((line) => JSON.parse(line).event)).toEqual([
		"certificate.renewing",
		"certificate.renewed",
	]);
	expect(capture.lines.join("")).not.toContain("SECRET");
});

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
