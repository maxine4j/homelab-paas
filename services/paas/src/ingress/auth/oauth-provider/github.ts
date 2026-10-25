import { z } from "zod";

import type { IPaasConfig } from "../../../config/paas-config.ts";
import type { AuthedUserDetails } from "../types.ts";
import type { GitHubEndpoints, Oauth2Provider } from "./types.ts";
export class GitHubOauth2Provider implements Oauth2Provider {
	constructor(
		private readonly config: IPaasConfig,
		private readonly request: typeof fetch,
		private readonly endpoints: GitHubEndpoints = {
			authorization: "https://github.com/login/oauth/authorize",
			token: "https://github.com/login/oauth/access_token",
			profile: "https://api.github.com/user",
		},
	) {}
	getLoginUrl(state: string, callbackUrl: string): string {
		const url = new URL(this.endpoints.authorization);
		url.search = new URLSearchParams({
			client_id: this.config.getAuthConfig()!.github.clientId,
			redirect_uri: callbackUrl,
			state,
		}).toString();
		return url.href;
	}
	async fetchAccessToken(code: string, callbackUrl: string): Promise<string> {
		try {
			const response = await this.request(this.endpoints.token, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					client_id: this.config.getAuthConfig()!.github.clientId,
					client_secret: this.config.getAuthConfig()!.github.clientSecret,
					redirect_uri: callbackUrl,
					code,
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok)
				throw new Error(`GitHub token exchange failed: HTTP ${response.status}: ${await response.text()}`);
			return z
				.object({ access_token: z.string().min(1), token_type: z.literal("bearer") })
				.parse(await response.json()).access_token;
		} catch (cause) {
			throw new Error("GitHub authentication unavailable", { cause });
		}
	}
	async fetchUserDetails(token: string): Promise<AuthedUserDetails> {
		try {
			const response = await this.request(this.endpoints.profile, {
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": "2022-11-28",
					"User-Agent": "homelab-paas",
				},
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok)
				throw new Error(`GitHub profile lookup failed: HTTP ${response.status}: ${await response.text()}`);
			return { userId: z.object({ login: z.string().min(1) }).parse(await response.json()).login };
		} catch (cause) {
			throw new Error("GitHub authentication unavailable", { cause });
		}
	}
}
