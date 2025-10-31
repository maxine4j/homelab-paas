import acme from 'acme-client';
import { ConfigService } from '../../../util/config';
import { logger } from '../../../util/logger';
import { DnsAcmeChallengeProviderRegistry } from './dns-challenge/registry';

export class TlsCertProvisionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly challengeProviderRegistry: DnsAcmeChallengeProviderRegistry,
  ) {}

  public async provisionCert() {
    const { challengeProvider, rootDomain, notificationEmail } =
      this.getConfig();

    const client = new acme.Client({
      directoryUrl: this.getDirectoryUrl(),
      accountKey: await acme.crypto.createPrivateKey(),
    });

    const altNames = [rootDomain, `*.${rootDomain}`];
    const [key, csr] = await acme.crypto.createCsr({
      altNames,
    });
    logger.info({ altNames }, 'Created certificate signing request');

    const statefulChallenge = challengeProvider.createStatefulChallenge();
    const cert = await client.auto({
      csr,
      email: notificationEmail,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: statefulChallenge.createChallenge,
      challengeRemoveFn: statefulChallenge.removeChallenge,
    });

    logger.info({ altNames }, 'Provisioned certificate');
    return {
      key: key.toString(),
      cert: cert.toString(),
    };
  }

  private getDirectoryUrl() {
    const { letsEncryptEnv } = this.getConfig();
    switch (letsEncryptEnv) {
      case 'production':
        return acme.directory.letsencrypt.production;
      case 'staging':
        return acme.directory.letsencrypt.staging;
    }
  }

  private getConfig() {
    const config = this.configService.getConfig();

    return {
      letsEncryptEnv: config.paas.tls.letsEncryptEnv,
      rootDomain: config.paas.rootDomain,
      notificationEmail: config.paas.tls.notificationEmail,
      challengeProvider: this.challengeProviderRegistry.getProvider(
        config.paas.tls.dnsChallengeProvider.type,
      ),
    };
  }
}
