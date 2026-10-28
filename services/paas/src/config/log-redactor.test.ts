import { expect, test } from "vitest";

import { LogRedactor } from "./log-redactor.ts";

test("holds split secrets, multiline values and URL credentials before publishing bounded safe text", () => {
	const redact = new LogRedactor(["supersecret", "multi\nline"]);
	expect(redact.push("hello sup")).toBe("hello ");
	expect(redact.push("ersecret multi\n")).toBe("[redacted] ");
	expect(redact.push("line https://alice:pass")).toBe("[redacted] ");
	expect(redact.push("word@host/path\n")).toBe("https://[redacted]@host/path\n");
	expect(redact.push("https://alice:password", true)).toBe("[redacted]");
});

test("rejects unbounded pending tokens without disclosing their contents", () => {
	const redact = new LogRedactor([]);
	expect(() => redact.push(`https://${"x".repeat(262145)}`)).toThrow("Log output exceeds pending limit");
});

test("redacts URL path secrets and holds overlapping secrets across all chunk splits", () => {
	for (let split = 0; split <= 26; split++) {
		const redactor = new LogRedactor(["abcd", "abcdef", "TOKEN"]);
		const text = "abcdef https://host/TOKEN\n";
		expect(redactor.push(text.slice(0, split)) + redactor.push(text.slice(split), true)).toBe(
			"[redacted] https://host/[redacted]\n",
		);
	}
});

test("URL credentials remain secret when known secrets overlap schemes or cross credential boundaries", () => {
	for (const secrets of [["http"], ["password@host/tail"]]) {
		const text = "https://user:password@host/tail\n";
		for (let split = 0; split < text.length; split++) {
			const redactor = new LogRedactor(secrets);
			const output = redactor.push(text.slice(0, split)) + redactor.push(text.slice(split), true);
			expect(output).not.toContain("user");
			expect(output).not.toContain("password");
		}
	}
});

test("multiline secret holdback cannot divide a terminated URL and publish its credential prefix", () => {
	const redactor = new LogRedactor(["pass@host\nsuffix"]);
	expect(redactor.push("https://user:pass@host\n")).toBe("");
	const output = redactor.push("suffix\n");
	expect(output).not.toContain("user");
	expect(output).not.toContain("pass");
	expect(output).not.toContain("suffix");
});

test("valid URL userinfo is redacted even with an absent or empty password", () => {
	for (const value of ["https://alice@host/\n", "https://alice:@host/\n", "https://:password@host/\n"]) {
		const redactor = new LogRedactor([]);
		expect(redactor.push(value)).toBe("https://[redacted]@host/\n");
	}
	const value = "HTTP://alice:password@host/\n";
	for (let split = 0; split <= value.length; split++) {
		const redactor = new LogRedactor([]);
		expect(redactor.push(value.slice(0, split)) + redactor.push(value.slice(split), true)).toBe(
			"HTTP://[redacted]@host/\n",
		);
	}
});

test("userinfo containing raw at-signs is masked through the authority's last delimiter", () => {
	const value = "http://alpha:p@ss@host/path?q=public@value\n";
	for (let split = 0; split <= value.length; split++) {
		const redactor = new LogRedactor([]);
		expect(redactor.push(value.slice(0, split)) + redactor.push(value.slice(split), true)).toBe(
			"http://[redacted]@host/path?q=public@value\n",
		);
	}
});
