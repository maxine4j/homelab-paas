import { DnsAcmeChallengeProvider } from './types';
import { ContextualError } from '../../../../util/error';
import { logger } from '../../../../util/logger';

export const createDigitalOceanDnsAcmeChallengeProvider = (
  digitaloceanDomain: string,
  digitaloceanAccessToken: string,
): DnsAcmeChallengeProvider => {

  const createChallenge = async (authzIdentifier: string, keyAuthorization: string) => {
    const prunedIdentified = authzIdentifier.split(`.${digitaloceanDomain}`)[0];
    logger.info({ authzIdentifier, prunedIdentified }, 'Creating digitalocean dns challenge');
    const name = `_acme-challenge.${prunedIdentified}`;
    const value = keyAuthorization;

    const response = await fetch(`https://api.digitalocean.com/v2/domains/${digitaloceanDomain}/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${digitaloceanAccessToken}`,
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

  const removeChallenge = async (challengeRecordId: string) => {
    if (!challengeRecordId) {
      throw new ContextualError('Failed to clean up TXT record for acme challenge, challengeRecordId not defined');
    }

    const response = await fetch(`https://api.digitalocean.com/v2/domains/${digitaloceanDomain}/records/${challengeRecordId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${digitaloceanAccessToken}`,
      }
    });

    if (!response.ok) {
      throw new ContextualError('Failed to remove challenge record, bad response from digitalocean');
    }
  };

  return {
    createStateFulChallenge: () => {
      let challengeRecordId: string | undefined;
      return {
        createChallenge: async (authz, challenge, keyAuthorization) => {
          if (challenge.type !== 'dns-01') {
            throw new ContextualError('Unsupported challenge type', { type: challenge.type });
          }
          challengeRecordId = await createChallenge(authz.identifier.value, keyAuthorization);
        },
        removeChallenge: async () => {
          if (!challengeRecordId) {
            throw new ContextualError('Failed to remove challenge record, no challengeRecordId founds');
          }
          await removeChallenge(challengeRecordId);
        },
      }
    },
  }
}