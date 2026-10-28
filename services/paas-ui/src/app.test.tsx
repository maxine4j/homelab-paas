import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { App } from "./app.tsx";

test("main navigation is in the page header with services and cluster links", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(/<header class="primary-header">.*<nav aria-label="Main navigation">/);
	expect(html).toContain('href="#/services" aria-current="page">Services</a>');
	expect(html).toContain('href="#/cluster">Cluster config</a>');
	expect(html).not.toContain("<aside");
});
