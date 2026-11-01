import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { CodeHighlight } from "./code-highlight.tsx";

test.each([
	["yaml", "image: app:1\nreplicas: 2\n", "key"],
	["json", '{\n  "ready": true\n}', "property"],
	["stacktrace", "Error: failed\n    at start (src/start.ts:12:3)\nCaused by: TypeError: bad", "function"],
	["log", '2026-11-02 INFO ready\n{"level":30,"msg":"ready"}\n    at start (src/start.ts:12:3)\n', "property"],
] as const)("highlights %s while preserving the exact source text", (language, children, token) => {
	const html = renderToStaticMarkup(<CodeHighlight language={language}>{children}</CodeHighlight>);
	expect(html).toContain(`language-${language}`);
	expect(html).toContain(`token ${token}`);
	expect(html.replace(/<[^>]*>/g, "").replaceAll("&quot;", '"')).toBe(children);
});

test("renders hostile markup as text without creating executable elements", () => {
	const html = renderToStaticMarkup(
		<CodeHighlight language='yaml'>{'message: "<script>alert(1)</script>&"\n'}</CodeHighlight>,
	);
	expect(html).not.toContain("<script>");
	expect(html).toContain("&lt;script&gt;");
	expect(html).toContain("&amp;");
});
