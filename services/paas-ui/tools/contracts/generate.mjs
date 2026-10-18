import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compile } from "json-schema-to-typescript";

export async function generate(schemas) {
  const declarations = [];
  for (const name of Object.keys(schemas).sort()) {
    declarations.push(
      await compile(schemas[name], name, {
        bannerComment: "/* Generated from Rust contracts. Do not edit. */",
        unknownAny: true,
        additionalProperties: false,
      }),
    );
  }
  return declarations.join("\n");
}

if (process.argv.at(1) && import.meta.url === pathToFileURL(process.argv.at(1)).href) {
  const schemas = JSON.parse(await readFile(process.argv.at(2), "utf8"));
  process.stdout.write(await generate(schemas));
}
