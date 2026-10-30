import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServiceRevision } from "./service-revision.tsx";

test("revision links show short hashes and open the full GitHub commit in a new tab", () => {
	const revision = "abcdef0123456789abcdef0123456789abcdef01";
	const href = `https://github.com/owner/repo/commit/${revision}`;
	const html = renderToStaticMarkup(
		<ServiceRevision label='Active revision' revision={revision} href={href} fallback='Not deployed' />,
	);
	expect(html).toContain(`href="${href}"`);
	expect(html).toContain('target="_blank" rel="noreferrer"');
	expect(html).toContain(`title="${revision}"`);
	expect(html).toContain(">abcdef0</a>");
	expect(html).not.toContain("Copy");
});

test("unsupported sources show a short hash without a broken link and missing revisions retain their fallback", () => {
	const html = renderToStaticMarkup(
		<ServiceRevision label='Desired revision' revision='abcdef0123456' fallback='Unavailable' />,
	);
	expect(html).toContain(">abcdef0</span>");
	expect(html).not.toContain("<a");
	expect(renderToStaticMarkup(<ServiceRevision label='Active revision' fallback='Not deployed' />)).toContain(
		"Not deployed",
	);
});
