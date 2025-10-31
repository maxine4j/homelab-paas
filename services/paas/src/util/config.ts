import yaml from 'yaml';
import { z } from 'zod';
import { PeriodicTask } from '../task/periodic';
import { ContextualError } from './error';
import { logger } from './logger';
import { validate } from './validation';

export type PaasConfig = z.infer<typeof PaasConfig>;
const PaasConfig = z.object({
  paas: z.object({
    rootDomain: z.string(),

    auth: z.object({
      jwtSecret: z.string(),
      sessionLifetimeSeconds: z.number(),
      oauth2Provider: z.object({
        type: z.literal('github'),
        clientId: z.string(),
        clientSecret: z.string(),
      }),
      authorizedUserIds: z.array(z.string()),
      adminUserIds: z.array(z.string()),
      deployTokens: z.array(
        z.object({
          name: z.string(),
          token: z.string(),
          authorizedServices: z.array(z.string()),
        }),
      ),
    }),

    tls: z.object({
      notificationEmail: z.string(),
      letsEncryptEnv: z.union([z.literal('staging'), z.literal('production')]),
      dnsChallengeProvider: z.object({
        type: z.literal('digitalocean'),
        domain: z.string(),
        accessToken: z.string(),
      }),
    }),
  }),
});

export class ConfigService {
  private config: PaasConfig | undefined;
  private paasHostname: string | undefined;

  private constructor(
    private readonly readFile: (name: string) => Promise<string | undefined>,
  ) {}

  static async create(readFile: (name: string) => Promise<string | undefined>) {
    const configService = new ConfigService(readFile);
    await configService.reloadConfig();
    return configService;
  }

  public getConfig(): PaasConfig {
    if (!this.config) {
      throw new ContextualError('Config is undefined');
    }
    return this.config;
  }

  public getPaasContainerHostname(): string {
    if (!this.paasHostname) {
      throw new ContextualError('Paas hostname is undefined');
    }
    return this.paasHostname;
  }

  public getAuthCookieName() {
    return 'homelab-paas-auth';
  }

  public async reloadConfig(): Promise<void> {
    const paasHostnameFilePath = '/etc/hostname';
    const maybePaasHostname = await this.readFile(paasHostnameFilePath);
    if (!maybePaasHostname) {
      throw new ContextualError(
        `Failed to load paas container hostname from ${paasHostnameFilePath}`,
      );
    }
    this.paasHostname = maybePaasHostname.trim();

    const paasConfigFilePath = '/etc/homelab-paas/config.yaml';
    const maybeConfigYaml = await this.readFile(paasConfigFilePath);
    if (!maybeConfigYaml) {
      throw new ContextualError(
        `Failed to load paas config from ${paasConfigFilePath}`,
      );
    }

    let parsedConfig: unknown;
    try {
      parsedConfig = yaml.parse(maybeConfigYaml);
    } catch (error) {
      throw new ContextualError('Failed to parse paas config as yaml');
    }

    try {
      this.config = validate(parsedConfig, PaasConfig);
    } catch (error) {
      logger.error('Failed to validate paas config');
      throw error;
    }
  }
}

export class ConfigReloadTask implements PeriodicTask {
  constructor(private readonly configService: ConfigService) {}

  public async run(): Promise<void> {
    this.configService.reloadConfig();
    logger.info('Reloaded config');
  }
}
