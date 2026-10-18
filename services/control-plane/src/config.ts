import { inspect } from "node:util";
import { isIP } from "node:net";
import { Ajv } from "ajv";
import { parseYaml, YamlError } from "./yaml.ts";
import { openRoot, readBounded } from "./posix.ts";

export interface HostConfig {
  clusterDomain: string;
  tls: {
    digitalOceanTokenRef: string;
    acme: { environment: "staging" | "production"; email: string };
  };
  auth: {
    github: {
      clientId: string;
      clientSecretRef: string;
      callbackUrl: string;
      allowedUsernames: string[];
      adminUsernames: string[];
    };
  };
  gitops: {
    discovery: {
      owners: {
        type: "user" | "org";
        name: string;
        credentialRef: string;
      }[];
    };
  };
}

export class ConfigError extends Error {
  readonly path: string;
  readonly problem: string;
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = "ConfigError";
    this.path = path;
    this.problem = problem;
  }
}

// Private validated configuration. It contains references only and is safe to serialize.
type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;
export type ValidatedConfig = DeepReadonly<HostConfig>;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
const text = { type: "string" };
function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
const strings = { type: "array", items: text };
const validateShape = new Ajv({ strict: true }).compile<HostConfig>(
  object({
    clusterDomain: text,
    tls: object({
      digitalOceanTokenRef: text,
      acme: object({ environment: { enum: ["staging", "production"] }, email: text }),
    }),
    auth: object({
      github: object({
        clientId: text,
        clientSecretRef: text,
        callbackUrl: text,
        allowedUsernames: strings,
        adminUsernames: strings,
      }),
    }),
    gitops: object({
      discovery: object({
        owners: {
          type: "array",
          items: object({ type: { enum: ["user", "org"] }, name: text, credentialRef: text }),
        },
      }),
    }),
  }),
);

export const MAX_CONFIG_BYTES = 1024 * 1024;
const githubName = (name: string) =>
  name.length <= 39 && !name.includes("--") && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(name);
const credentialName = (name: string) => /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(name);
function domainName(name: string) {
  return (
    name.length <= 248 &&
    name.includes(".") &&
    !isIP(name) &&
    name
      .split(".")
      .every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  );
}
function reference(name: string, path: string) {
  if (!credentialName(name))
    throw new ConfigError(
      path,
      "use a credential name: 1-128 ASCII letters/digits, hyphens or underscores, starting with a letter/digit",
    );
}
function usernames(names: string[], path: string) {
  if (!names.length) throw new ConfigError(path, "configure at least one explicit username");
  if (names.some((name) => !githubName(name)))
    throw new ConfigError(
      path,
      "use GitHub usernames: 1-39 ASCII letters/digits with single internal hyphens",
    );
  return [...new Set(names.map((name) => name.toLowerCase()))].sort();
}

export function parseConfig(source: string): HostConfig {
  try {
    const value = parseYaml(source, "config.yaml", MAX_CONFIG_BYTES);
    if (!validateShape(value))
      throw new ConfigError(
        "config.yaml",
        "invalid schema; check required fields, types and unknown fields",
      );
    return value;
  } catch (error) {
    if (error instanceof YamlError) throw new ConfigError(error.location, error.message);
    throw error;
  }
}

export function validateConfig(input: HostConfig): ValidatedConfig {
  if (!validateShape(input)) throw new ConfigError("config.yaml", "invalid configuration schema");
  const config = structuredClone(input);
  config.clusterDomain = config.clusterDomain.toLowerCase();
  if (!domainName(config.clusterDomain))
    throw new ConfigError(
      "clusterDomain",
      "use a DNS domain with at least two labels (maximum 248 bytes)",
    );
  reference(config.tls.digitalOceanTokenRef, "tls.digitalOceanTokenRef");
  const email = config.tls.acme.email.split("@");
  if (
    email.length !== 2 ||
    !email.at(0) ||
    !domainName(email.at(1) ?? "") ||
    /\s/.test(config.tls.acme.email)
  ) {
    throw new ConfigError("tls.acme.email", "provide an ACME contact email");
  }
  const github = config.auth.github;
  if (!github.clientId || /\s/.test(github.clientId))
    throw new ConfigError("auth.github.clientId", "provide the GitHub OAuth client ID");
  reference(github.clientSecretRef, "auth.github.clientSecretRef");
  let callback: URL;
  try {
    callback = new URL(github.callbackUrl);
  } catch {
    throw new ConfigError("auth.github.callbackUrl", "provide a valid HTTPS callback URL");
  }
  if (
    callback.protocol !== "https:" ||
    callback.hostname !== `paas.${config.clusterDomain}` ||
    callback.port ||
    callback.username ||
    callback.password ||
    github.callbackUrl.includes("?") ||
    github.callbackUrl.includes("#") ||
    !callback.pathname.startsWith("/api/") ||
    callback.pathname.length <= 5 ||
    /\s/.test(github.callbackUrl)
  ) {
    throw new ConfigError(
      "auth.github.callbackUrl",
      "register an HTTPS callback under /api/ on paas.<clusterDomain>, without credentials, query, fragment, or alternate port",
    );
  }
  github.allowedUsernames = usernames(github.allowedUsernames, "auth.github.allowedUsernames");
  github.adminUsernames = usernames(github.adminUsernames, "auth.github.adminUsernames");
  if (!config.gitops.discovery.owners.length)
    throw new ConfigError("gitops.discovery.owners", "configure at least one discovery owner");
  const seen = new Set<string>();
  for (const [index, owner] of config.gitops.discovery.owners.entries()) {
    const path = `gitops.discovery.owners[${index}]`;
    owner.name = owner.name.toLowerCase();
    if (!githubName(owner.name))
      throw new ConfigError(`${path}.name`, "use a valid GitHub owner name");
    if (seen.has(owner.name))
      throw new ConfigError(path, "remove duplicate discovery owners (case-insensitive)");
    seen.add(owner.name);
    reference(owner.credentialRef, `${path}.credentialRef`);
  }
  return freeze(config);
}

export class SecretValue {
  #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  expose(): string {
    return this.#value;
  }
  toJSON() {
    return "[REDACTED]";
  }
  [inspect.custom]() {
    return "[REDACTED]";
  }
}

export class BootstrapConfig {
  #secrets: Map<string, SecretValue>;
  readonly config: ValidatedConfig;
  private constructor(config: ValidatedConfig, secrets: Map<string, SecretValue>) {
    this.config = config;
    this.#secrets = secrets;
  }
  secret(reference: string): SecretValue {
    const value = this.#secrets.get(reference);
    if (!value) throw new ConfigError("secrets.yaml", "referenced credential is missing");
    return value;
  }
  static async load(root: string): Promise<BootstrapConfig> {
    const handles: { close(): void }[] = [];
    let path = "storageRoot";
    try {
      const directory = openRoot(root);
      handles.push(directory);
      path = "_platform";
      const platform = directory.directory("_platform", false, false);
      handles.push(platform);
      path = "config.yaml";
      const config = validateConfig(
        parseConfig(readBounded(platform, path, MAX_CONFIG_BYTES, "public")),
      );
      path = "secrets.yaml";
      const values = parseYaml(
        readBounded(platform, path, MAX_CONFIG_BYTES, "secret"),
        path,
        MAX_CONFIG_BYTES,
      );
      if (values === null || typeof values !== "object" || Array.isArray(values))
        throw new ConfigError(path, "use a credential-name to string mapping");
      const secrets = new Map<string, SecretValue>();
      for (const [name, value] of Object.entries(values)) {
        if (!credentialName(name) || typeof value !== "string" || !value.trim())
          throw new ConfigError(path, "use valid credential names and non-empty string values");
        secrets.set(name, new SecretValue(value));
      }
      const loaded = new BootstrapConfig(config, secrets);
      const required: [string, string][] = [
        [config.tls.digitalOceanTokenRef, "tls.digitalOceanTokenRef"],
        [config.auth.github.clientSecretRef, "auth.github.clientSecretRef"],
        ...config.gitops.discovery.owners.map((owner, index): [string, string] => [
          owner.credentialRef,
          `gitops.discovery.owners[${index}].credentialRef`,
        ]),
      ];
      for (const [name, field] of required)
        if (!secrets.has(name))
          throw new ConfigError(field, "add the named credential to _platform/secrets.yaml");
      return loaded;
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      if (error instanceof YamlError) throw new ConfigError(error.location, error.message);
      throw new ConfigError(
        path,
        "provide a readable regular host file/directory with secure permissions; symlinks are forbidden",
      );
    } finally {
      for (const handle of handles.reverse()) handle.close();
    }
  }
}
