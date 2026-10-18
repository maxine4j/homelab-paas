import yaml from "yaml";
import { z } from "zod";
import type { PeriodicTask } from "../task/periodic.ts";
import { ConfigError } from "./env.ts";

export type PaasConfig = z.infer<typeof PaasConfig>;
const PaasConfig = z.object({
  paas: z.object({
    rootDomain: z.string(),

    auth: z.object({
      jwtSecret: z.string(),
      sessionLifetimeSeconds: z.number(),
      oauth2Provider: z.object({
        type: z.literal("github"),
        clientId: z.string(),
        clientSecret: z.string(),
      }),
      authorizedUserIds: z.array(z.string()),
      adminUserIds: z.array(z.string()),
    }),

    tls: z.object({
      envType: z.union([z.literal("staging"), z.literal("production")]),
      dnsChallengeProvider: z.object({
        type: z.literal("digitalocean"),
        domain: z.string(),
        accessToken: z.string(),
      }),
    }),
  }),
});

export class ConfigService {
  private config: PaasConfig | undefined;
  private paasHostname: string | undefined;

  private readonly readFile: (name: string) => Promise<string | undefined>;
  private constructor(readFile: (name: string) => Promise<string | undefined>) {
    this.readFile = readFile;
  }

  static async create(readFile: (name: string) => Promise<string | undefined>) {
    const configService = new ConfigService(readFile);
    await configService.reloadConfig();
    return configService;
  }

  public getConfig(): PaasConfig {
    if (!this.config) {
      throw new ConfigError("config", "Config is undefined");
    }
    return this.config;
  }

  public getPaasContainerHostname(): string {
    if (!this.paasHostname) {
      throw new ConfigError("config", "Paas hostname is undefined");
    }
    return this.paasHostname;
  }

  public getAuthCookieName() {
    return "homelab-paas-auth";
  }

  public async reloadConfig(): Promise<void> {
    const paasHostnameFilePath = "/etc/hostname";
    const maybePaasHostname = await this.readFile(paasHostnameFilePath);
    if (!maybePaasHostname) {
      throw new ConfigError(
        "config",
        `Failed to load paas container hostname from ${paasHostnameFilePath}`,
      );
    }
    this.paasHostname = maybePaasHostname.trim();

    const paasConfigFilePath = "/etc/homelab-paas/config.yaml";
    const maybeConfigYaml = await this.readFile(paasConfigFilePath);
    if (!maybeConfigYaml) {
      throw new ConfigError("config", `Failed to load paas config from ${paasConfigFilePath}`);
    }

    let parsedConfig: unknown;
    try {
      parsedConfig = yaml.parse(maybeConfigYaml);
    } catch {
      throw new ConfigError("config", "Failed to parse paas config as yaml");
    }

    try {
      const result = PaasConfig.safeParse(parsedConfig);
      if (!result.success) throw new ConfigError("config", "invalid fields or types");
      this.config = result.data;
    } catch {
      throw new ConfigError("config", "invalid fields or types");
    }
  }
}

export class ConfigReloadTask implements PeriodicTask {
  private readonly configService: { reloadConfig(): Promise<void> };
  constructor(configService: { reloadConfig(): Promise<void> }) {
    this.configService = configService;
  }

  public async run(): Promise<void> {
    await this.configService.reloadConfig();
  }
}
