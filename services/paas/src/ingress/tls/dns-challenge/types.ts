import type acme from "acme-client";
import type { Challenge } from "acme-client/types/rfc8555.js";

export interface DnsAcmeChallengeProvider {
	createStatefulChallenge(): {
		createChallenge: (authz: acme.Authorization, challenge: Challenge, keyAuthorization: string) => Promise<void>;
		removeChallenge: (authz: acme.Authorization, challenge: unknown, keyAuthorization: string) => Promise<void>;
	};
}
