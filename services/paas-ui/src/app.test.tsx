import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./app.tsx";

afterEach(() => vi.unstubAllEnvs());

test("footer identifies the platform build with a short revision and full revision tooltip", () => {
	vi.stubEnv("VITE_BUILD_SHA", "1234567890abcdef1234567890abcdef12345678");
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(
		/<footer>.*<span title="1234567890abcdef1234567890abcdef12345678">Build 1234567<\/span>.*<\/footer>/,
	);
});

test("footer explicitly identifies builds without a supplied revision", () => {
	vi.stubEnv("VITE_BUILD_SHA", undefined);
	expect(renderToStaticMarkup(<App />)).toMatch(/<footer>.*Build unknown.*<\/footer>/);
});

test("main navigation is in the page header with services and cluster links", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toMatch(/<header class="primary-header">.*<nav aria-label="Main navigation">/);
	expect(html).toContain('href="#/services" aria-current="page">Services</a>');
	expect(html).toContain('href="#/cluster">Cluster config</a>');
	expect(html).not.toContain("<aside");
});
