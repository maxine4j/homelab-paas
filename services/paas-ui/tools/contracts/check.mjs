import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import { generate } from "./generate.mjs";

const [schemaPath, fixturesPath, declarationsPath] = process.argv.slice(2);
const schemas = JSON.parse(await readFile(schemaPath, "utf8"));
const fixtures = JSON.parse(await readFile(fixturesPath, "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
const validators = new Map(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);
assert.deepEqual(new Set(fixtures.map((fixture) => fixture.contract)), new Set(validators.keys()));
for (const { contract, valid, value } of fixtures) {
  const validate = validators.get(contract);
  assert.ok(validate, `Unknown fixture contract: ${contract}`);
  assert.equal(validate(value), valid, `${contract}: ${JSON.stringify(value)}`);
}
const declarations = await readFile(declarationsPath, "utf8");
assert.equal(declarations, await generate(schemas), "Generation must be reproducible");
assert.doesNotMatch(declarations, /\bany\b/, "Use unknown at untyped boundaries");
