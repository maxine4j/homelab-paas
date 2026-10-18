import { RuleTester } from "oxlint/plugins-dev";
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { noRecursiveTypes } from "./lint-rules.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("no-recursive-types", noRecursiveTypes, {
  valid: [
    "type Label = string; type Settings = { labels: readonly Label[] };",
    "type ReadonlyFields<T> = { readonly [K in keyof T]: T[K] };",
    "type A = string; function f() { type B = A; return 1; }",
    "type A = string; function f<A>() { type B = A; return 1; }",
    "type Box<T> = { value: T }; type Other = Box<string>;",
    "type A = { method<A>(value: A): A };",
    "interface A { method<A>(value: A): A }",
    "type Item<T> = T extends (infer Item)[] ? Item : never;",
    "type Key = { [Key in 'first' | 'second']: Key };",
    "namespace Model { export type A = string; export type B = A[]; }",
  ],
  invalid: [
    { code: "type Tree = { children: Tree[] };", errors: [{ messageId: "recursive" }] },
    {
      code: "type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };",
      errors: [{ messageId: "recursive" }],
    },
    { code: "type A = { b: B }; type B = { a: A };", errors: 2 },
    { code: "interface Tree { children: Tree[] }", errors: [{ messageId: "recursive" }] },
    { code: "interface A { b: B } type B = { a: A };", errors: 2 },
    { code: "interface A extends B {} interface B { a: A }", errors: 2 },
    { code: "type A = { first: A; second: A };", errors: 1 },
    { code: "namespace Model { export type Tree = { children: Model.Tree[] }; }", errors: 1 },
  ],
});

it("repository lint rejects recursive aliases and type-only cycles across files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "paas-lint-")));
  try {
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } }),
    );
    await writeFile(join(root, "recursive.ts"), "export type Tree = { children: Tree[] };");
    await writeFile(
      join(root, "a.ts"),
      'import type { B } from "./b.ts"; export type A = { b: B };',
    );
    await writeFile(
      join(root, "b.ts"),
      'import type { A } from "./a.ts"; export type B = { a: A };',
    );
    const result = await promisify(execFile)("pnpm", [
      "exec",
      "oxlint",
      "--config",
      fileURLToPath(new URL("../.oxlintrc.json", import.meta.url)),
      root,
    ]).then(
      () => {
        throw new Error("lint accepted recursive definitions");
      },
      (error) => error,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("no-recursive-types");
    expect(result.stdout).toContain("no-cycle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
