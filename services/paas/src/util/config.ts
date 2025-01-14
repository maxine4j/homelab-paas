const unwrapEnv = (envVarName: string): string => {
  const value = process.env[envVarName];
  if (typeof value !== 'string') throw Error(`Env var missing: ${envVarName}`);
  return value;
}

export const config = {
  httpPort: 8080,
  httpsPort: 8443,
  paasContainerName: process.env['PAAS_CONTAINER_NAME'] ?? '/homelab-paas-1',
  rootDomain: unwrapEnv('PAAS_ROOT_DOMAIN'),
  auth: {
    cookieName: 'homelab-paas-auth',
    sessionLifetimeSeconds: 60 * 60 * 24 * 7, // 1 week
    clientId: unwrapEnv('PAAS_AUTH_CLIENT_ID'),
    clientSecret: unwrapEnv('PAAS_AUTH_CLIENT_SECRET'),
    jwtSecret: unwrapEnv('PAAS_AUTH_JWT_SECRET'),
    authorizedUsers: unwrapEnv('PAAS_AUTH_AUTHORIZED_USERS').split(','),
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
