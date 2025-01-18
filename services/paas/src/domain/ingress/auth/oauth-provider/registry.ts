import { ConfigService } from '../../../../util/config';
import { GitHubOauth2Provider } from './github';
import { Oauth2Provider } from './types';

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
