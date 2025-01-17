import acme from 'acme-client';
import { logger } from '../../../util/logger';
import { DnsAcmeChallengeProvider } from './dns-challenge/types';
import { ContextualError } from '../../../util/error';

export interface TlsCertificateProvisionHandler {
  (): Promise<{
    key: string
    cert: string
  }>
}

export const createTlsCertificateProvisionHandler = (
  expiryNotificationEmail: string,
  paasRootDomain: string,
  letsencryptEnv: string,
  challengeProvider: DnsAcmeChallengeProvider,
) => {

  const getDirectoryUrl = () => {
    switch (letsencryptEnv) {
      case 'production': return acme.directory.letsencrypt.production;
      case 'staging': return acme.directory.letsencrypt.staging;
      default: throw new ContextualError('Invalid PAAS_TLS_LETSENCRYPT_ENV, expected staging or production', { letsencryptEnv });
    }
  }

  return async () => {
    const client = new acme.Client({
      directoryUrl: getDirectoryUrl(),
      accountKey: await acme.crypto.createPrivateKey(),
    });

    const altName = `*.${paasRootDomain}`;
    const [key, csr] = await acme.crypto.createCsr({
      altNames: [altName],
    });
    logger.info({ altName }, 'Created certificate signing request');

    const statefulChallenge = challengeProvider.createStateFulChallenge();
    const cert = await client.auto({
        csr,
        email: expiryNotificationEmail,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        challengeCreateFn: statefulChallenge.createChallenge,
        challengeRemoveFn: statefulChallenge.removeChallenge,
    });

    logger.info({ altName }, 'Provisioned certificate');
    return {
      key: key.toString(),
      cert: cert.toString(),
    };
  }
}
