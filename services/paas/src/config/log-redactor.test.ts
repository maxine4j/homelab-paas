import { expect, test } from "vitest";

import { LogRedactor } from "./log-redactor.ts";

test("preserves ordinary log text, timestamps and status codes", () => {
	const text = '2026-11-01T07:23:50Z {"status":200,"durationMs":15004,"message":"token secret password 0"}\n';
	expect(new LogRedactor().push(text, true)).toBe(text);
});

test.each([
	["Authorization: Bearer abc def\n", "Authorization: [redacted]\n"],
	["proxy-authorization=Basic abc\n", "proxy-authorization=[redacted]\n"],
	["Cookie: session=abc; other=def\n", "Cookie: [redacted]\n"],
	["Set-Cookie: session=abc; HttpOnly\n", "Set-Cookie: [redacted]\n"],
	[
		'{"headers":{"Authorization":"Bearer abc","cookie":"sid=abc"},"status":200}\n',
		'{"headers":{"Authorization":"[redacted]","cookie":"[redacted]"},"status":200}\n',
	],
	[
		'{"password":"a\\\"b","accessToken":"abc","client_secret":"def","apiKey":"ghi"}\n',
		'{"password":"[redacted]","accessToken":"[redacted]","client_secret":"[redacted]","apiKey":"[redacted]"}\n',
	],
	["PASSWORD=abc\nmessage: ready\n", "PASSWORD=[redacted]\nmessage: ready\n"],
])("masks named credential fields across every chunk split: %s", (text, expected) => {
	for (let split = 0; split <= text.length; split++) {
		const redactor = new LogRedactor();
		expect(redactor.push(text.slice(0, split)) + redactor.push(text.slice(split), true)).toBe(expected);
	}
});

test("retains unfinished lines until complete and masks final unterminated fields", () => {
	const redactor = new LogRedactor();
	expect(redactor.push("Authorization: Bearer abc")).toBe("");
	expect(redactor.push("", true)).toBe("Authorization: [redacted]");
});

test("rejects oversized pending lines without disclosing their contents", () => {
	expect(() => new LogRedactor().push("x".repeat(262145))).toThrow("Log output exceeds pending limit");
});
