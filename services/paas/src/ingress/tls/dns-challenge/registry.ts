import { ConfigService } from '../../../util/config.ts';
import { DigitalOceanDnsAcmeChallengeProvider } from './digitalocean-dns-challenge-provider.ts';
import type { DnsAcmeChallengeProvider } from './types.ts';

type DnsAcmeChallengeProviderType = 'digitalocean';

export class DnsAcmeChallengeProviderRegistry {
  constructor(private readonly configService: ConfigService) {}

  getProvider(
    providerType: DnsAcmeChallengeProviderType,
  ): DnsAcmeChallengeProvider {
    switch (providerType) {
      case 'digitalocean':
        return new DigitalOceanDnsAcmeChallengeProvider(this.configService);
    }
  }
}
