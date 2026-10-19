import { ConfigService } from '../../../util/config.ts';
import { GitHubOauth2Provider } from './github.ts';
import type { Oauth2Provider } from './types.ts';

type Oauth2ProviderType = 'github';

export class Oauth2ProviderRegistry {
  constructor(private readonly configService: ConfigService) {}

  getProvider(providerType: Oauth2ProviderType): Oauth2Provider {
    switch (providerType) {
      case 'github':
        return new GitHubOauth2Provider(this.configService);
    }
  }
}
