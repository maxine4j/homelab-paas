import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { copyLogJson, LogEntry } from "./log-entry.tsx";
import { presentLog } from "./structured-log.ts";

test("copies the complete JSON record including message, timestamp, severity and error context", async () => {
	const data = { level: 50, time: 0, msg: "failed", error: { message: "outer", cause: { message: "root" } } };
	const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
	expect(await copyLogJson(data, { writeText })).toBe("Copied JSON");
	expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(data, undefined, 2));
});

test("copy failure feedback is safe and retryable", async () => {
	const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce(new Error("private"));
	expect(await copyLogJson({}, { writeText })).toBe("Unable to copy JSON");
	writeText.mockResolvedValueOnce();
	expect(await copyLogJson({}, { writeText })).toBe("Copied JSON");
	expect(await copyLogJson({}, undefined)).toBe("Unable to copy JSON");
});

test("details are collapsed initially with message and minute timestamp in the summary", () => {
	const entry = presentLog('{"time":0,"msg":"Ready","level":"info"}')!;
	const html = renderToStaticMarkup(<LogEntry entry={entry} />);
	expect(html).toMatch(/^<details class="log-entry log-entry-info"><summary>/);
	expect(html).toMatch(/<summary>[^]*Ready[^]*<time[^]*<\/summary>/);
	expect(html).toContain('class="text-action"');
	expect(html).toContain('role="status"');
});
