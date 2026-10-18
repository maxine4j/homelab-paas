import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, expect, test } from "vitest";
import {
  BootstrapConfig,
  ConfigError,
  MAX_CONFIG_BYTES,
  parseConfig,
  validateConfig,
} from "./config.ts";

const VALID = `clusterDomain: Example.COM
tls:
  digitalOceanTokenRef: dns-token
  acme:
    environment: staging
    email: admin@example.com
auth:
  github:
    clientId: client-id
    clientSecretRef: oauth-secret
    callbackUrl: https://paas.example.com/api/auth/callback
    allowedUsernames: [App-User]
    adminUsernames: [Admin-User]
gitops:
  discovery:
    owners:
      - type: user
        name: Source-User
        credentialRef: github-read
`;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "paas-config-"));
  roots.push(root);
  return root;
}
async function fixture() {
  const root = await directory();
  await mkdir(join(root, "_platform"), { mode: 0o700 });
  await writeFile(join(root, "_platform/config.yaml"), VALID);
  await writeFile(
    join(root, "_platform/secrets.yaml"),
    "dns-token: canary-dns\noauth-secret: canary-oauth\ngithub-read: canary-read\n",
    { mode: 0o600 },
  );
  return root;
}

test("normalizes independent access/discovery scopes", () => {
  const config = validateConfig(parseConfig(VALID));
  expect(config.clusterDomain).toBe("example.com");
  expect(config.auth.github.allowedUsernames).toEqual(["app-user"]);
  expect(config.auth.github.adminUsernames).toEqual(["admin-user"]);
  expect(config.gitops.discovery.owners.at(0)?.name).toBe("source-user");
  expect(
    validateConfig(parseConfig(VALID.replace("[App-User]", "[App-User, app-user]"))).auth.github
      .allowedUsernames,
  ).toEqual(["app-user"]);
  expect(
    validateConfig(
      parseConfig(VALID.replace("type: user", "type: org")),
    ).gitops.discovery.owners.at(0)?.type,
  ).toBe("org");
});

test("rejects incomplete, malformed, unsafe and duplicate configuration", () => {
  for (const [before, after] of [
    ["Example.COM", "../etc"],
    ["Example.COM", "localhost"],
    ["Example.COM", "-bad.example.com"],
    ["[App-User]", "[]"],
    ["[Admin-User]", "[]"],
    ["[App-User]", "[bad--name]"],
    ["[Admin-User]", "[bad_name]"],
    ["Source-User", "../bad"],
    ["dns-token", "../secret"],
    ["client-id", "''"],
    ["admin@example.com", "invalid"],
    ["staging", "other"],
    ["https://paas.example.com", "http://paas.example.com"],
    ["https://paas.example.com", "https://evil.example.com"],
    ["https://paas.example.com", "https://user:password@paas.example.com"],
    ["/api/auth/callback", "/api/auth/callback?secret=canary"],
    ["/api/auth/callback", "/api/auth/callback#"],
    ["type: user", "type: invalid"],
    ["type: user", "type: organization"],
  ])
    expect(() => validateConfig(parseConfig(VALID.replace(before ?? "", after ?? "")))).toThrow(
      ConfigError,
    );
  for (const yaml of [
    "",
    "{}",
    "secret: canary",
    "auth: [canary",
    "clusterDomain: canary\nclusterDomain: other",
    "a: &a [*a]",
  ]) {
    try {
      parseConfig(yaml);
      throw new Error("accepted invalid fixture");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(inspect(error)).not.toContain("canary");
    }
  }
  const noOwners = parseConfig(VALID);
  noOwners.gitops.discovery.owners = [];
  expect(() => validateConfig(noOwners)).toThrow();
  const duplicate = parseConfig(VALID);
  duplicate.gitops.discovery.owners.push(...duplicate.gitops.discovery.owners);
  expect(() => validateConfig(duplicate)).toThrow("duplicate");
});

test("syntax diagnostics locate errors without echoing input", () => {
  try {
    parseConfig("auth: [canary");
    throw new Error("accepted syntax error");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).path).toMatch(/^config.yaml:\d+:\d+/);
    expect(inspect(error)).not.toContain("canary");
  }
});

test("loads named credentials while redacting serialization and debug output", async () => {
  const loaded = await BootstrapConfig.load(await fixture());
  const secret = loaded.secret(loaded.config.auth.github.clientSecretRef);
  expect(secret.expose()).toBe("canary-oauth");
  expect(JSON.stringify(loaded)).not.toContain("canary");
  expect(inspect(loaded)).not.toContain("canary");
  expect(inspect(secret)).not.toContain("canary");
  expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
});

test("invalid credentials and insecure secret-file permissions fail closed", async () => {
  const root = await fixture();
  const path = join(root, "_platform/secrets.yaml");
  for (const yaml of [
    "{}",
    "dns-token: ''",
    "dns-token: canary\ndns-token: other",
    "../bad: canary",
    "dns-token: [canary]",
    "dns-token: canary\ninvalid-key!: canary",
  ]) {
    await writeFile(path, yaml);
    try {
      await BootstrapConfig.load(root);
      throw new Error("accepted invalid secret");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(inspect(error)).not.toContain("canary");
    }
  }
  for (const mode of [0o644, 0o640, 0o666]) {
    await chmod(path, mode);
    await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
  }
});

test("missing credential references identify the configuration field", async () => {
  const root = await fixture();
  for (const [name, path] of [
    ["dns-token", "tls.digitalOceanTokenRef"],
    ["oauth-secret", "auth.github.clientSecretRef"],
    ["github-read", "gitops.discovery.owners[0].credentialRef"],
  ] as const) {
    await writeFile(join(root, "_platform/config.yaml"), VALID.replace(name, "missing"));
    await expect(BootstrapConfig.load(root)).rejects.toMatchObject({
      path,
      problem: expect.stringContaining("secrets.yaml"),
    });
  }
});

test("rejects symlinks, nonregular files, missing and oversized input", async () => {
  const root = await fixture();
  const outside = await directory();
  await symlink(join(root, "_platform"), join(outside, "_platform"));
  await expect(BootstrapConfig.load(outside)).rejects.toBeInstanceOf(ConfigError);
  const path = join(root, "_platform/secrets.yaml");
  await rm(path);
  await symlink("config.yaml", path);
  await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
  await rm(path);
  await mkdir(path);
  await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
  await rm(path, { recursive: true });
  await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
  expect(() => parseConfig(" ".repeat(MAX_CONFIG_BYTES + 1))).toThrow(ConfigError);
  const config = join(root, "_platform/config.yaml");
  const original = await readFile(config);
  await writeFile(config, Buffer.alloc(MAX_CONFIG_BYTES + 1, 32));
  await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
  await writeFile(config, original);
  await writeFile(path, Buffer.alloc(MAX_CONFIG_BYTES + 1, 32), { mode: 0o600 });
  await expect(BootstrapConfig.load(root)).rejects.toBeInstanceOf(ConfigError);
});
