import acme from 'acme-client';
import { logger } from '../../../util/logger';
import { DnsAcmeChallengeProvider } from './dns-challenge/types';

export interface TlsCertificateProvisionHandler {
  (): Promise<{
    key: string
    cert: string
  }>
}

export const createTlsCertificateProvisionHandler = (
  expiryNotificationEmail: string,
  paasRootDomain: string,
  challengeProvider: DnsAcmeChallengeProvider,
) => {

  return async () => {
    const client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.staging,
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
