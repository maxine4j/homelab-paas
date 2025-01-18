import { readFileSync } from 'node:fs';

const unwrapEnv = (envVarName: string): string => {
  const value = process.env[envVarName];
  if (typeof value !== 'string') throw Error(`Env var missing: ${envVarName}`);
  return value;
}

export const config = {
  httpPort: 8080,
  httpsPort: 8443,
  paasContainerId: readFileSync('/etc/hostname', 'utf-8').trim(),
  rootDomain: unwrapEnv('PAAS_ROOT_DOMAIN'),
  auth: {
    cookieName: 'homelab-paas-auth',
    sessionLifetimeSeconds: 60 * 60 * 24 * 7, // 1 week
    githubClientId: unwrapEnv('PAAS_AUTH_CLIENT_ID'),
    githubClientSecret: unwrapEnv('PAAS_AUTH_CLIENT_SECRET'),
    jwtSecret: unwrapEnv('PAAS_AUTH_JWT_SECRET'),
    authorizedUsers: unwrapEnv('PAAS_AUTH_AUTHORIZED_USERS').split(','), // users must be here to access anything in the paas
    paasAdminUsers: unwrapEnv('PAAS_AUTH_PAAS_ADMIN_USERS').split(','), // users must be here to access paas functionality itself
  },
  tls: {
    notificationEmail: unwrapEnv('PAAS_TLS_NOTIFICATION_EMAIL'),
    letsencryptEnv: unwrapEnv('PAAS_TLS_LETSENCRYPT_ENV'),
    digitalocean: {
      domain: unwrapEnv('PAAS_TLS_DIGITALOCEAN_DOMAIN'),
      accessToken: unwrapEnv('PAAS_TLS_DIGITALOCEAN_ACCESS_TOKEN'),
    }
  },
};
