/** Challenge IDs distinguish simultaneous apex/wildcard authorizations. */
export interface StatefulDnsChallenge {
	/** Throws DnsChallengeError; record identifiers remain private to the client. */
	createChallenge(id: string, domain: string, value: string, signal?: AbortSignal): Promise<void>;
	/** Idempotent after successful deletion; failures retain the ID for retry. */
	removeChallenge(id: string, signal?: AbortSignal): Promise<void>;
}

export interface DnsAcmeChallengeProvider {
	createStatefulChallenge(): StatefulDnsChallenge;
}

export class DnsChallengeError extends Error {}
