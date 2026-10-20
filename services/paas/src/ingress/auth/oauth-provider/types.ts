import type { AuthedUserDetails } from "../types.ts";

export interface Oauth2Provider {
	getLoginUrl(state: string): string;
	fetchAccessToken(code: string): Promise<string>;
	fetchUserDetails(accessToken: string): Promise<AuthedUserDetails>;
}
