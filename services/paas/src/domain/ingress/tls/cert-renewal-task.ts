import { PeriodicTask } from '../../../task/periodic';
import { TlsCertificateProvisionHandler } from './cert-provision-handler';

const certificateFile = '/etc/homelab-paas/cert.json';

export const createTlsCertRenewalTask = (
  provisionCertificate: TlsCertificateProvisionHandler,
  writeFile: (name: string, data: string) => Promise<void>
): PeriodicTask => {

  // FIXME
  const hasExistingNonExpiredCert = async () => false;

  return async () => {
    if (await hasExistingNonExpiredCert()) {
      return;
    }

    const { key, cert } = await provisionCertificate();
    await writeFile(certificateFile, JSON.stringify({
      key, 
      cert,
    }));
  };
};
