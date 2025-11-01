export interface AuthedUserDetails {
  userId: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface Oauth2Provider {
  getLoginUrl(finalRedirectUri: string): string;
  fetchAccessToken(code: string): Promise<string>;
  fetchUserDetails(accessToken: string): Promise<AuthedUserDetails>;
}
