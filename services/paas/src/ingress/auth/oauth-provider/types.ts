export interface AuthedUserDetails {
	/** Immutable GitHub account ID; username is checked separately against access policy. */
	userId: string;
	username: string;
	name?: string;
	email?: string;
	avatarUrl?: string;
}

export interface LoginRequest {
	state: string;
	codeChallenge: string;
}

/** The login service owns state verification, PKCE generation and return-URL policy. */
export interface Oauth2Provider {
	getLoginUrl(request: LoginRequest): string;
	/** Throws OauthProviderError on transport, provider or validation failure. */
	fetchAccessToken(code: string, codeVerifier: string, signal?: AbortSignal): Promise<string>;
	/** Throws OauthProviderError on transport, provider or validation failure. */
	fetchUserDetails(accessToken: string, signal?: AbortSignal): Promise<AuthedUserDetails>;
}

export class OauthProviderError extends Error {
	constructor() {
		super("GitHub OAuth request failed");
	}
}
