import { expect, test } from "vitest";

import { parseSecretEnv, serializeSecretEnv } from "./secret-env.ts";

test("roundtrips literal dotenv values including empty, whitespace, hashes and quotes", () => {
	const values = new Map([
		["EMPTY", ""],
		["TOKEN", " a#b=$c\\d "],
		["SINGLE", "a'b"],
		["DOUBLE", 'a"b'],
	]);
	expect(parseSecretEnv(serializeSecretEnv(values))).toEqual(values);
});

test.each(["a\nb", "a\rb", "a\0b", `both'"quotes`])(
	"rejects values the single-line dotenv format cannot preserve",
	(value) => {
		expect(() => serializeSecretEnv(new Map([["TOKEN", value]]))).toThrow("single-line");
	},
);
