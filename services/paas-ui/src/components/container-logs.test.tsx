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

test("log output highlights structured JSON and stack frames", () => {
	const html = renderToStaticMarkup(
		<ContainerLogs
			content={'{"msg":"failed","code":"E_FAILED"}\nError: failed\n    at start (src/start.ts:1:2)\n'}
		/>,
	);
	expect(html).toContain('class="language-log"');
	expect(html).toContain('class="token property"');
	expect(html).toContain('class="token function"');
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

test("JSON lines become expandable severity cards, including Docker-prefixed Pino output", () => {
	const time = "2026-11-05T01:04:09.000Z";
	const html = renderToStaticMarkup(
		<ContainerLogs
			content={[
				`${time} ${JSON.stringify({ level: 30, time, msg: "Listening", port: 8080 })}`,
				JSON.stringify({ level: "warn", message: "Retrying" }),
				JSON.stringify({ level: 50, error: { message: "Failed" } }),
				JSON.stringify({ level: "debug", msg: "Checking" }),
			].join("\n")}
		/>,
	);
	for (const level of ["info", "warn", "error", "debug"]) expect(html).toContain(`log-entry-${level}`);
	expect(html).toContain("<details");
	expect(html).toContain("Listening");
	expect(html).toContain("Retrying");
	expect(html).toContain("Failed");
	expect(html).toContain("Checking");
	expect(html).toContain("Copy JSON");
	expect(html).toContain("Context");
	expect(html).toContain("8080");
	expect(html).toContain(
		new Date(time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
	);
	expect(html).toContain(
		new Date(time).toLocaleString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: true,
		}),
	);
});

test("message precedence and arbitrary JSON objects preserve every remaining field", () => {
	const html = renderToStaticMarkup(
		<ContainerLogs
			content={JSON.stringify({
				message: "Main",
				msg: "Other",
				error: { message: "Inner" },
				custom: { value: "kept" },
			})}
		/>,
	);
	expect(html).toMatch(/log-message[^>]*>Main</);
	expect(html).toContain("Other");
	expect(html).toContain("Inner");
	expect(html).toContain("kept");
	expect(renderToStaticMarkup(<ContainerLogs content='{"custom":"only"}' />)).toContain("Copy JSON");
});

test("error causes and nested stack fields appear below context with stack highlighting", () => {
	const html = renderToStaticMarkup(
		<ContainerLogs
			content={JSON.stringify({
				level: "error",
				msg: "Request failed",
				err: {
					message: "Outer",
					stack: "Error: Outer\n    at start (src/start.ts:1:2)",
					cause: {
						message: "Inner",
						stack: "Error: Inner\n    at read (src/read.ts:3:4)",
						cause: { message: "Root" },
					},
				},
				provider: { stack: "Error: Provider\n    at send (src/send.ts:5:6)" },
			})}
		/>,
	);
	expect(html.indexOf("Context")).toBeLessThan(html.indexOf("Stack trace"));
	expect(html).toContain('class="language-stacktrace"');
	expect(html).toContain('class="token function"');
	expect(html.replace(/<[^>]+>/g, "")).toContain("Caused by:");
	expect(html).toContain("Root");
	expect(html).toContain("Provider");
});

test("mixed malformed, scalar and plain lines remain visible and markup stays escaped", () => {
	const html = renderToStaticMarkup(
		<ContainerLogs content={'{"msg":"<script>bad</script>"}\n{broken\nnull\n[1,2]\nplain output\n'} />,
	);
	expect(html).toContain("Copy JSON");
	expect(html.replace(/<[^>]+>/g, "")).toContain("{broken");
	expect(html).toContain("null");
	expect(html).toContain("plain output");
	expect(html).not.toContain("<script>");
});

test("renders HTTP and key/value summaries alongside plain stack lines using Docker event times", () => {
	const docker = "2026-11-05T04:43:55.999223622Z ";
	const html = renderToStaticMarkup(
		<ContainerLogs
			content={[
				docker + 'logger=cleanup t=2026-11-04T12:00:00Z level=error msg="Cleanup failed"',
				docker + "GET /health 200 2 - 0.188 ms",
				docker + "\tsync/waitgroup.go:251 +0x45",
			].join("\n")}
		/>,
	);
	expect(html).toMatch(/log-message[^>]*>Cleanup failed</);
	expect(html).toMatch(/log-message[^>]*>GET \/health → 200</);
	expect(html).toContain('dateTime="2026-11-05T04:43:55.999Z"');
	expect(html).toContain('class="language-log"');
	expect(html.replace(/<[^>]+>/g, "")).toContain("\tsync/waitgroup.go:251 +0x45");
});
