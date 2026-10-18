import { LineCounter, parseDocument, visit } from "yaml";

export class YamlError extends Error {
  readonly location: string;
  constructor(file: string, line?: number, column?: number) {
    super("invalid YAML/schema; check required fields, types, unknown fields, and duplicate keys");
    this.name = "YamlError";
    this.location = line === undefined ? file : `${file}:${line}:${column}`;
  }
}

/** Never propagate parser errors: their messages contain source excerpts. */
export function parseYaml(
  source: string,
  file: string,
  maximumBytes: number,
  intAsBigInt = false,
): unknown {
  if (Buffer.byteLength(source) > maximumBytes) throw new YamlError(file);
  const lineCounter = new LineCounter();
  try {
    const document = parseDocument(source, {
      uniqueKeys: true,
      lineCounter,
      version: "1.2",
      intAsBigInt,
    });
    const error = document.errors.at(0);
    if (error) {
      const position = lineCounter.linePos(error.pos.at(0) ?? 0);
      throw new YamlError(file, position.line, position.col);
    }
    if (document.warnings.length > 0) throw new YamlError(file);
    visit(document, (_key, _node, path) => {
      if (path.length > 32) throw new YamlError(file);
    });
    return document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    if (error instanceof YamlError) throw error;
    throw new YamlError(file);
  }
}
