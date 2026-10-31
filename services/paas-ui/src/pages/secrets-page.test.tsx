import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { SecretsPage, setSecret } from "./secrets-page.tsx";

test.each(["new-value", ""])(
	"submits only one secret, including empty deletion, and returns fresh status",
	async (value) => {
		const next = { revision: "r2", variables: [{ name: "TOKEN", configured: value !== "", used: true }] };
		const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(next)));
		const update = vi.fn();
		await setSecret("demo", "r1", "TOKEN", value, new AbortController().signal, request, update);
		expect(update).toHaveBeenCalledExactlyOnceWith(next);
		expect(request).toHaveBeenCalledExactlyOnceWith(
			"/api/ui/services/demo/secrets",
			expect.objectContaining({
				method: "PUT",
				body: JSON.stringify({ revision: "r1", changes: [{ name: "TOKEN", value }] }),
			}),
		);
	},
);

test("a rejected write refreshes the revision for retry without swallowing its failure", async () => {
	const next = { revision: "current", variables: [] };
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response("", { status: 409 }))
		.mockResolvedValueOnce(new Response(JSON.stringify(next)));
	const update = vi.fn();
	await expect(
		setSecret("demo", "stale", "TOKEN", "replacement", new AbortController().signal, request, update),
	).rejects.toThrow("Secrets changed. Try again.");
	expect(update).toHaveBeenCalledExactlyOnceWith(next);
	expect(request).toHaveBeenCalledTimes(2);
});

test("cancelled submissions never replace the visible snapshot", async () => {
	const abort = new AbortController();
	const update = vi.fn();
	const request = vi.fn<typeof fetch>().mockImplementation(async () => {
		abort.abort();
		return new Response(JSON.stringify({ revision: "r2", variables: [] }));
	});
	await setSecret("demo", "r1", "TOKEN", "replacement", abort.signal, request, update);
	expect(update).not.toHaveBeenCalled();
});

test("secrets page omits implementation prose and bulk controls", () => {
	const html = renderToStaticMarkup(<SecretsPage serviceId='demo' />);
	for (const text of ["Saved to", "/etc/", "drafts", "Reload", "Save secrets", "single-line"])
		expect(html).not.toContain(text);
});

test("secrets heading appears outside the form card like other service tab headings", () => {
	const html = renderToStaticMarkup(<SecretsPage serviceId='demo' />);
	expect(html).toContain('<h2>Service secrets</h2><section class="card secrets-editor"');
	expect(html).not.toMatch(/<section class="card secrets-editor"[^>]*><h2>/);
});
