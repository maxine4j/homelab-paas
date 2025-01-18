import { z } from 'zod';
import yaml from 'yaml';
import { ContextualError } from './error';
import { validate } from './validation';
import { logger } from './logger';

const unwrapEnv = (envVarName: string): string => {
  const value = process.env[envVarName];
  if (typeof value !== 'string') throw Error(`Env var missing: ${envVarName}`);
  return value;
};

// export const config = {
//   httpPort: 8080,
//   httpsPort: 8443,
//   paasContainerId: readFileSync('/etc/hostname', 'utf-8').trim(),
//   rootDomain: unwrapEnv('PAAS_ROOT_DOMAIN'),
//   auth: {
//     cookieName: 'homelab-paas-auth',
//     sessionLifetimeSeconds: 60 * 60 * 24 * 7, // 1 week
//     githubClientId: unwrapEnv('PAAS_AUTH_CLIENT_ID'),
//     githubClientSecret: unwrapEnv('PAAS_AUTH_CLIENT_SECRET'),
//     jwtSecret: unwrapEnv('PAAS_AUTH_JWT_SECRET'),
//     authorizedUsers: unwrapEnv('PAAS_AUTH_AUTHORIZED_USERS').split(','), // users must be here to access anything in the paas
//     paasAdminUsers: unwrapEnv('PAAS_AUTH_PAAS_ADMIN_USERS').split(','), // users must be here to access paas functionality itself
//   },
//   tls: {
//     notificationEmail: unwrapEnv('PAAS_TLS_NOTIFICATION_EMAIL'),
//     letsencryptEnv: unwrapEnv('PAAS_TLS_LETSENCRYPT_ENV'),
//     digitalocean: {
//       domain: unwrapEnv('PAAS_TLS_DIGITALOCEAN_DOMAIN'),
//       accessToken: unwrapEnv('PAAS_TLS_DIGITALOCEAN_ACCESS_TOKEN'),
//     }
//   },
// };

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

  constructor(
    private readonly readFileSync: (name: string) => string | undefined,
  ) {
    this.reloadConfig();
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

  public reloadConfig(): void {
    const paasHostnameFilePath = '/etc/hostname';
    const maybePaasHostname = this.readFileSync(paasHostnameFilePath)?.trim();
    if (!maybePaasHostname) {
      throw new ContextualError(
        `Failed to load paas container hostname from ${paasHostnameFilePath}`,
      );
    }
    this.paasHostname = maybePaasHostname;

    const paasConfigFilePath = '/etc/homelab-paas/config.yaml';
    const maybeConfigYaml = this.readFileSync(paasConfigFilePath);
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
