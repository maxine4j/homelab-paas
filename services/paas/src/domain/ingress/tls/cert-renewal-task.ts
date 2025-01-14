import { PeriodicTask } from '../../../task/periodic';
import { daysBetween } from '../../../util/date';
import { logger } from '../../../util/logger';
import { TlsCertificateProvisionHandler } from './cert-provision-handler';
import { X509Certificate } from 'crypto';

const certificateFileJson = '/etc/homelab-paas/cert.json';
const certificateFilePem = '/etc/homelab-paas/cert.pem';

const certificateMinDaysUntilExpiry = 30;

export const createTlsCertRenewalTask = (
  provisionCertificate: TlsCertificateProvisionHandler,
  writeFile: (name: string, data: string) => Promise<void>,
  readFile: (name: string) => Promise<string | undefined>,
  now: () => Date,
): PeriodicTask => {

  const certificateRequiresRenewal = async () => {
    const certificatePem = await readFile(certificateFilePem);
    if (!certificatePem) {
      logger.info('No certificate found, requesting renewal');
      return true;
    }

    const { validTo, subject, subjectAltName } = new X509Certificate(certificatePem);
    const daysUntilExpiry = daysBetween(now(), new Date(validTo));

    logger.info({ validTo, daysUntilExpiry, subject, subjectAltName }, 'Existing certificate found');

    if (daysUntilExpiry < certificateMinDaysUntilExpiry) {
      logger.info(`Certificate requires renewal, valid for less than ${certificateMinDaysUntilExpiry} days`)
      return true;
    }

    logger.info('Certificate does not require renewal')
    return false;
  }

  return async () => {
    logger.info('Starting cert renewal task');
    if (!await certificateRequiresRenewal()) {
      return;
    }

    const { key, cert } = await provisionCertificate();
    await writeFile(certificateFilePem, `${key}\n${cert}`);
  };
};
