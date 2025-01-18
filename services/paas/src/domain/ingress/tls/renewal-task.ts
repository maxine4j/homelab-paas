import { PeriodicTask } from '../../../task/periodic';
import { daysBetween } from '../../../util/date';
import { logger } from '../../../util/logger';
import { TlsCertProvisionService } from './provision-service';
import { X509Certificate } from 'crypto';

const privateKeyFilePem = '/etc/homelab-paas/key.pem';
const certificateFilePem = '/etc/homelab-paas/cert.pem';

const certificateMinDaysUntilExpiry = 30;

interface HttpsServer {
  setSecureContext: (options: {
    cert: string,
    key: string,
  }) => void
}

export class TlsCertRenewalTask implements PeriodicTask {

  constructor (
    private readonly tlsCertProvisionService: TlsCertProvisionService,
    private readonly httpsServer: HttpsServer,
    private readonly writeFile: (name: string, data: string) => Promise<void>,
    private readonly readFile: (name: string) => Promise<string | undefined>,
    private readonly now: () => Date,
  ) {}

  public async run() {
    logger.info('Starting cert renewal task');
    await this.updateHttpsServerCertIfExists();

    if (!await this.certificateRequiresRenewal()) {
      return;
    }

    const { key, cert } = await this.tlsCertProvisionService.provisionCert();
    await Promise.all([
      this.writeFile(privateKeyFilePem, key),
      this.writeFile(certificateFilePem, cert),
    ]);

    this.httpsServer.setSecureContext({
      cert, 
      key
    });
  }

  private async updateHttpsServerCertIfExists() {
    const certificatePem = await this.readFile(certificateFilePem);
    const privateKetPem = await this.readFile(privateKeyFilePem);
    if (certificatePem && privateKetPem) {
      this.httpsServer.setSecureContext({
        cert: certificatePem,
        key: privateKetPem,
      });
    }
  };

  private async certificateRequiresRenewal() {
    const certificatePem = await this.readFile(certificateFilePem);
    if (!certificatePem) {
      logger.info('No certificate found, requesting renewal');
      return true;
    }

    const { validTo, subject, subjectAltName } = new X509Certificate(certificatePem);
    const daysUntilExpiry = daysBetween(this.now(), new Date(validTo));

    logger.info({ validTo, daysUntilExpiry, subject, subjectAltName }, 'Existing certificate found');

    if (daysUntilExpiry < certificateMinDaysUntilExpiry) {
      logger.info(`Certificate requires renewal, valid for less than ${certificateMinDaysUntilExpiry} days`)
      return true;
    }

    logger.info('Certificate does not require renewal')
    return false;
  }
};
