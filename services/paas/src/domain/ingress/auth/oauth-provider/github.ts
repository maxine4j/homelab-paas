import { ConfigService } from '../../../../util/config';
import { ContextualError } from '../../../../util/error';
import { logger } from '../../../../util/logger';
import { AuthedUserDetails, Oauth2Provider } from './types';

export class GitHubOauth2Provider implements Oauth2Provider {
  constructor(private readonly configService: ConfigService) {}

  public getLoginUrl(finalRedirectUri: string): string {
    const { rootDomain, clientId } = this.getConfig();
    const redirectUri = `https://${rootDomain}/auth/callback?redirect_uri=${encodeURI(finalRedirectUri)}`;
    return `https://github.com/login/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURI(redirectUri)}&scope=${encodeURI('user:email')}`;
  }

  public async fetchAccessToken(code: string): Promise<string> {
    const { clientId, clientSecret } = this.getConfig();
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
        }),
      },
    );
    const responseBody = await response.json();
    const accessToken = responseBody['access_token'];
    logger.info(
      { status: response.status },
      'Fetched access token from github',
    );

    return accessToken;
  }

  public async fetchUserDetails(
    accessToken: string,
  ): Promise<AuthedUserDetails> {
    const [user, email] = await Promise.all([
      this.fetchGithubUser(accessToken),
      this.fetchUserEmail(accessToken),
    ]);

    return {
      userId: user.username,
      name: user.name,
      email,
      avatarUrl: user.avatarUrl,
    };
  }

  private async fetchGithubUser(accessToken: string) {
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const responseBody = await response.json();
    logger.info(
      { status: response.status },
      'Fetched user details from github',
    );

    return {
      username: responseBody['login'],
      name: responseBody['name'],
      avatarUrl: responseBody['avatar_url'],
    };
  }

  private async fetchUserEmail(accessToken: string) {
    const response = await fetch('https://api.github.com/user/emails', {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const responseBody = (await response.json()) as Array<{
      email: string;
      primary: boolean;
    }>;
    logger.info({ status: response.status }, 'Fetched user emails from github');

    return responseBody.find((emailResponse) => emailResponse.primary)?.email;
  }

  private getConfig() {
    const providerConfig =
      this.configService.getConfig().paas.auth.oauth2Provider;
    if (providerConfig.type !== 'github') {
      throw new ContextualError(
        'Failed to configure github oauth2 provider. Missing provider config',
      );
    }

    return {
      rootDomain: this.configService.getConfig().paas.rootDomain,
      clientId: providerConfig.clientId,
      clientSecret: providerConfig.clientSecret,
    };
  }
}
