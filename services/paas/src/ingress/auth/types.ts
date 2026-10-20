export interface AuthedUserDetails {
	userId: string;
}
export interface SessionConfig {
	issuer: string;
	audience: string;
	signingKey: string;
	ttlSeconds: number;
}
export interface TokenClaims {
	userId?: string;
	nonce?: string;
	redirectUri?: string;
}
export interface Login {
	url: string;
	state: string;
	nonce: string;
}
export interface LoginResult {
	session: string;
	redirectUri: string;
}
