import type { AuthedUserDetails } from "../types.ts";

export interface Oauth2Provider {
	getLoginUrl(state: string, callbackUrl: string): string;
	fetchAccessToken(code: string, callbackUrl: string): Promise<string>;
	fetchUserDetails(accessToken: string): Promise<AuthedUserDetails>;
}
