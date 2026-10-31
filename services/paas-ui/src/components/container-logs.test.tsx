import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { ContainerLogs, copyRecentLogs } from "./container-logs.tsx";

test("log viewer provides explicit follow control and accessible log output", () => {
	const html = renderToStaticMarkup(<ContainerLogs content='safe output' />);
	expect(html).toContain("Pause follow");
	expect(html).toContain('aria-label="Container logs"');
	expect(html).toContain("safe output");
	expect(html).toContain("Copy recent logs");
});

test("copies the latest 200 lines, preserving a trailing newline", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	const lines = Array.from({ length: 210 }, (_, index) => `line ${index}`);
	expect(await copyRecentLogs(`${lines.join("\n")}\n`, { writeText })).toBe("Copied recent logs");
	expect(writeText).toHaveBeenCalledExactlyOnceWith(`${lines.slice(-200).join("\n")}\n`);
});

test("copy failures have safe feedback and can be retried", async () => {
	const writeText = vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValueOnce(undefined);
	expect(await copyRecentLogs("latest", { writeText })).toBe("Unable to copy logs");
	expect(await copyRecentLogs("latest", { writeText })).toBe("Copied recent logs");
	expect(await copyRecentLogs("latest", undefined)).toBe("Unable to copy logs");
});
