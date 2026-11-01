export interface AuthedUserDetails {
	userId: string;
	email?: string;
	name?: string;
}
export type AuthorizationDecision = "allowed" | "login" | "missing" | AuthedUserDetails;
export interface SessionConfig {
	issuer: string;
	audience: string;
	signingKey: string;
	ttlSeconds: number;
}
export interface TokenClaims {
	userId?: string;
	email?: string;
	name?: string;
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
