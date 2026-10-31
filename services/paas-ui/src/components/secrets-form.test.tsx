import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SecretsForm } from "./secrets-form.tsx";

test("each secret has a password field and individual submit, with unused extras last and New secret below", () => {
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
			onSet={async () => {}}
		/>,
	);
	expect(html).toContain("TOKEN");
	expect(html).toContain("Configured");
	expect(html).toContain("Missing");
	expect(html).toContain('class="badge badge-healthy">Configured');
	expect(html).toContain('class="badge badge-error">Missing');
	expect(html).toContain('class="badge badge-warning">Unused');
	expect(html.match(/>Configured<\/span>/g)).toHaveLength(1);
	expect(html).toContain('type="password"');
	expect(html.match(/type="submit"/g)).toHaveLength(3);
	expect(html.match(/>Set<\/button>/g)).toHaveLength(3);
	expect(html).not.toContain('type="checkbox"');
	expect(html).not.toContain("Saved value is never displayed");
	expect(html.indexOf("MISSING")).toBeLessThan(html.indexOf("EXTRA"));
	expect(html).toContain("Unused");
	expect(html).toContain("New secret");
	expect(html.indexOf("New secret")).toBeGreaterThan(html.indexOf("EXTRA"));
});

test("mock preview disables all editable controls", () => {
	const html = renderToStaticMarkup(
		<SecretsForm
			snapshot={{ revision: "r1", variables: [{ name: "TOKEN", used: true, configured: true }] }}
			disabled
			onSet={async () => {}}
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
			onSet={async () => {}}
		/>,
	);
	expect(html).not.toContain("[object Object]");
	expect(html).not.toContain("function Object");
});
