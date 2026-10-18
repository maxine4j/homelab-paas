import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { compile } from "json-schema-to-typescript";
import { schemas } from "../src/schemas.ts";

export async function generate() {
  const declarations = [];
  for (const name of Object.keys(schemas).sort()) {
    declarations.push(
      await compile(schemas[name], name, {
        bannerComment: "/* Generated from canonical shared schemas. Do not edit. */",
        unknownAny: true,
        additionalProperties: false,
      }),
    );
  }
  return declarations.join("\n");
}

const directory = new URL("../src/generated/", import.meta.url);
if (process.argv.includes("--check")) {
  const declarations = await readFile(new URL("contracts.ts", directory), "utf8");
  assert.equal(declarations, await generate(), "generation must be reproducible");
  assert.doesNotMatch(declarations, /\bany\b/, "use unknown at untyped boundaries");
} else {
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("contracts.ts", directory), await generate());
}
