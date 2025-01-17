import acme from 'acme-client';
import { logger } from '../../../util/logger';
import { DnsAcmeChallengeProvider } from './dns-challenge/types';
import { ContextualError } from '../../../util/error';

export class TlsCertProvisionService {
  constructor(
    private readonly expiryNotificationEmail: string,
    private readonly paasRootDomain: string,
    private readonly letsencryptEnv: string,
    private readonly challengeProvider: DnsAcmeChallengeProvider,
  ) {}

  public async provisionCert() {
    const client = new acme.Client({
      directoryUrl: this.getDirectoryUrl(),
      accountKey: await acme.crypto.createPrivateKey(),
    });

    const altName = `*.${this.paasRootDomain}`;
    const [key, csr] = await acme.crypto.createCsr({
      altNames: [altName],
    });
    logger.info({ altName }, 'Created certificate signing request');

    const statefulChallenge = this.challengeProvider.createStatefulChallenge();
    const cert = await client.auto({
        csr,
        email: this.expiryNotificationEmail,
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

  private getDirectoryUrl() {
    switch (this.letsencryptEnv) {
      case 'production': return acme.directory.letsencrypt.production;
      case 'staging': return acme.directory.letsencrypt.staging;
      default: throw new ContextualError('Invalid PAAS_TLS_LETSENCRYPT_ENV, expected staging or production', { letsencryptEnv: this.letsencryptEnv });
    }
  }
}
