import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { credentialReference, isApiError, isCredentialReference, schemas } from "../src/index.ts";
import type { ApiError, CredentialReference } from "../src/index.ts";

test("the same public fixtures validate at every consumer boundary", async () => {
  const fixtures: { contract: keyof typeof schemas; valid: boolean; value: unknown }[] = JSON.parse(
    await readFile(new URL("./fixtures.json", import.meta.url), "utf8"),
  );
  const validators = { ApiError: isApiError, CredentialReference: isCredentialReference };
  expect(new Set(fixtures.map((fixture) => fixture.contract))).toEqual(
    new Set(Object.keys(schemas)),
  );
  for (const fixture of fixtures)
    expect(validators[fixture.contract](fixture.value)).toBe(fixture.valid);
  expect(credentialReference("github-read")).toBe("github-read");
  expect(() => credentialReference("")).toThrow("required");
});

test("generated contracts remain typed without resolved secrets", () => {
  const reference: CredentialReference = "github-read";
  const missing: ApiError = { code: "not_found", diagnostics: [] };
  // @ts-expect-error Error codes are closed.
  const unknownCode: ApiError = { code: "unknown", diagnostics: [] };
  // @ts-expect-error Public errors never contain credentials.
  const secret: ApiError = { code: "not_found", diagnostics: [], secret: "value" };
  // @ts-expect-error References are names, not resolved values.
  const resolved: CredentialReference = { value: "secret" };
  void [reference, missing, unknownCode, secret, resolved];
});
