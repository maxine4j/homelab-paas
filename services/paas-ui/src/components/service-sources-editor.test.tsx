import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServiceSourcesEditor } from "./service-sources-editor.tsx";

test.each([
	["https://github.com/org/repo", "Access token", "Private key path"],
	["git@github.com:org/repo", "Private key path", "Access token"],
	["ssh://git@github.com/org/repo", "Private key path", "Access token"],
])("repository %s selects its credential controls", (remote, visible, hidden) => {
	const html = renderToStaticMarkup(
		<ServiceSourcesEditor
			rows={[{ serviceId: "demo", remote, branch: "", descriptorPath: "file.yaml", accessToken: "[redacted]" }]}
			readOnly={false}
			onChange={() => {}}
		/>,
	);
	expect(html).toContain(visible);
	expect(html).not.toContain(hidden);
	if (remote.startsWith("https:")) {
		expect(html).toContain('type="password"');
		expect(html).toContain("Configured");
		expect(html).not.toContain('value="[redacted]"');
		expect(html).toContain("Remove access token");
	}
});

test.each(["local", "/repo", "http://example.com/repo", ""])("repository %s shows no credentials", (remote) => {
	const html = renderToStaticMarkup(
		<ServiceSourcesEditor
			rows={[{ serviceId: "demo", remote, branch: "", descriptorPath: "file.yaml" }]}
			readOnly={false}
			onChange={() => {}}
		/>,
	);
	expect(html).not.toContain("Access token");
	expect(html).not.toContain("Private key path");
});
