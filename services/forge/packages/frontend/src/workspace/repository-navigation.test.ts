import { expect, test } from "vitest";

import { commitHref, commitSelection } from "./repository-navigation.ts";

test("commit links retain encoded browsing context and identify immutable commits", () => {
	const sha = "a".repeat(40);
	const href = commitHref(
		"project",
		"?branch=feature%2Ftest&path=src&file=src%2Fa.ts&view=history",
		sha,
		"split",
		"diff-0",
	);
	const url = new URL(href, "https://forge.test");
	expect(url.pathname).toBe("/projects/project/code");
	expect(url.searchParams.get("branch")).toBe("feature/test");
	expect(url.searchParams.get("file")).toBe("src/a.ts");
	expect(url.hash).toBe("#diff-0");
	expect(commitSelection(url.search)).toEqual({ kind: "commit", sha, mode: "split" });
	expect(commitSelection(`?view=commit&commit=${sha}`)).toEqual({ kind: "commit", sha, mode: "unified" });
});
test("malformed or ambiguous commit selections are explicit errors", () => {
	for (const search of [
		"?view=commit",
		"?view=commit&commit=main",
		`?view=commit&commit=${"a".repeat(40)}&diff=bad`,
		`?view=commit&commit=${"a".repeat(40)}&commit=${"b".repeat(40)}`,
		"?commit=bad",
	])
		expect(commitSelection(search)).toEqual({ kind: "invalid" });
	expect(commitSelection("?view=history&branch=main")).toEqual({ kind: "browse" });
});
