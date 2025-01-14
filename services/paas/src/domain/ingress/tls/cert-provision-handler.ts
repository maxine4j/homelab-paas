import path from 'path'; 
import acme from 'acme-client';
import { logger } from '../../../util/logger';
import { DnsAcmeChallengeProvider } from './dns-challenge/types';

acme.setLogger(logger.child({ source: 'acme-client' }).info);

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

    const [key, csr] = await acme.crypto.createCsr({
      altNames: [`*.${paasRootDomain}`],
    });

    const statefulChallenge = challengeProvider.createStateFulChallenge();
    const cert = await client.auto({
        csr,
        email: expiryNotificationEmail,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        challengeCreateFn: statefulChallenge.createChallenge,
        challengeRemoveFn: statefulChallenge.removeChallenge,
    });

    logger.info('Provisioned certificate');
    return {
      key,
      cert,
    };
  }
}
