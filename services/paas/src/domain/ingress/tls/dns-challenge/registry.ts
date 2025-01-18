import { ConfigService } from '../../../../util/config';
import { DigitalOceanDnsAcmeChallengeProvider } from './digitalocean';
import { DnsAcmeChallengeProvider } from './types';

type DnsAcmeChallengeProviderType =
  'digitalocean';

export class DnsAcmeChallengeProviderRegistry {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  getProvider(providerType: DnsAcmeChallengeProviderType): DnsAcmeChallengeProvider {
    switch (providerType) {
      case 'digitalocean': return new DigitalOceanDnsAcmeChallengeProvider(this.configService);
    }
  }
}
