import { DnsAcmeChallengeProvider } from './types';
import { ContextualError } from '../../../../util/error';
import { logger } from '../../../../util/logger';
import { Authorization } from 'acme-client';
import { Challenge } from 'acme-client/types/rfc8555';
import { ConfigService } from '../../../../util/config';

export class DigitalOceanDnsAcmeChallengeProvider implements DnsAcmeChallengeProvider {
  
  constructor(
    private readonly configService: ConfigService,
  ) {}
  
  public createStatefulChallenge() {
    let challengeRecordId: string | undefined;

    return {
      createChallenge: async (authz: Authorization, challenge: Challenge, keyAuthorization: string) => {
        if (challenge.type !== 'dns-01') {
          throw new ContextualError('Unsupported challenge type', { type: challenge.type });
        }
        challengeRecordId = await this.createChallenge(authz.identifier.value, keyAuthorization);
      },
      removeChallenge: async () => {
        if (!challengeRecordId) {
          throw new ContextualError('Failed to remove challenge record, no challengeRecordId founds');
        }
        await this.removeChallenge(challengeRecordId);
      },
    }
  }

  private async createChallenge(authzIdentifier: string, keyAuthorization: string) {
    const { accessToken, domain } = this.getConfig();
   
    const prunedIdentified = authzIdentifier.split(`.${domain}`)[0];
    logger.info({ authzIdentifier, prunedIdentified }, 'Creating digitalocean dns challenge');
    const name = `_acme-challenge.${prunedIdentified}`;
    const value = keyAuthorization;

    const response = await fetch(`https://api.digitalocean.com/v2/domains/${domain}/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'TXT',
        name,
        data: value,
        ttl: 300,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.json();
      throw new ContextualError('Failed to create TXT record for acme challenge, bad response from digitalocean', { responseStatus: response.status, responseBody });
    }

    const responseBody = await response.json() as { domain_record: { id: string } };
    return responseBody.domain_record.id;
  }

  private async removeChallenge(challengeRecordId: string) {
    const { accessToken, domain } = this.getConfig();

    if (!challengeRecordId) {
      throw new ContextualError('Failed to clean up TXT record for acme challenge, challengeRecordId not defined');
    }

    const response = await fetch(`https://api.digitalocean.com/v2/domains/${domain}/records/${challengeRecordId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      }
    });

    if (!response.ok) {
      throw new ContextualError('Failed to remove challenge record, bad response from digitalocean');
    }
  }

  private getConfig() {
    const providerConfig = this.configService.getConfig().paas.tls.dnsChallengeProvider;
    if (providerConfig.type !== 'digitalocean') {
      throw new ContextualError('Failed to configure digitalocean dnc acme challenge provider. Missing provider config');
    }
    return {
      accessToken: providerConfig.accessToken,
      domain: providerConfig.domain,
    }
  }
}
