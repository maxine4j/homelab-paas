import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SecretsForm } from "./secrets-form.tsx";

test("declared secret password fields show configured status, explicit empty replacement and unused extras last", () => {
	const html = renderToStaticMarkup(
		<SecretsForm
			snapshot={{
				revision: "r1",
				variables: [
					{ name: "TOKEN", used: true, configured: true },
					{ name: "MISSING", used: true, configured: false },
					{ name: "EXTRA", used: false, configured: true },
				],
			}}
			drafts={{}}
			onDraft={() => {}}
		/>,
	);
	expect(html).toContain("TOKEN");
	expect(html).toContain("Configured");
	expect(html).toContain("Missing");
	expect(html).toContain('type="password"');
	expect(html).toContain("empty value");
	expect(html.indexOf("MISSING")).toBeLessThan(html.indexOf("EXTRA"));
	expect(html).toContain("Unused");
	expect(html).toContain("Add variable");
});

test("mock preview disables all editable controls", () => {
	const html = renderToStaticMarkup(
		<SecretsForm
			snapshot={{ revision: "r1", variables: [{ name: "TOKEN", used: true, configured: true }] }}
			drafts={{}}
			disabled
			onDraft={() => {}}
		/>,
	);
	expect(html).toContain("disabled");
});

test("legal variable names matching Object prototype properties have blank saved-value inputs", () => {
	const html = renderToStaticMarkup(
		<SecretsForm
			snapshot={{
				revision: "r1",
				variables: [
					{ name: "__proto__", used: true, configured: true },
					{ name: "constructor", used: true, configured: true },
				],
			}}
			drafts={{}}
			onDraft={() => {}}
		/>,
	);
	expect(html).not.toContain("[object Object]");
	expect(html).not.toContain("function Object");
});
