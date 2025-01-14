import acme from 'acme-client';
import { Challenge } from 'acme-client/types/rfc8555';

export interface DnsAcmeChallengeProvider {
  createStateFulChallenge: () => {
    createChallenge: (authz: acme.Authorization, challenge: Challenge, keyAuthorization: string) => Promise<void>
    removeChallenge: (authz: acme.Authorization, challenge: unknown, keyAuthorization: string) => Promise<void>
  }
}
