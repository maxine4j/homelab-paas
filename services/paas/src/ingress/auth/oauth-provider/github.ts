import { z } from "zod";

import type { AuthedUserDetails } from "../types.ts";
import type { Oauth2Provider } from "./types.ts";
export class GitHubOauth2Provider implements Oauth2Provider {
	constructor(
		private readonly config: { clientId: string; clientSecret: string },
		private readonly request: typeof fetch,
	) {}
	getLoginUrl(state: string, callbackUrl: string): string {
		const url = new URL("https://github.com/login/oauth/authorize");
		url.search = new URLSearchParams({
			client_id: this.config.clientId,
			redirect_uri: callbackUrl,
			state,
		}).toString();
		return url.href;
	}
	async fetchAccessToken(code: string, callbackUrl: string): Promise<string> {
		try {
			const response = await this.request("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					client_id: this.config.clientId,
					client_secret: this.config.clientSecret,
					redirect_uri: callbackUrl,
					code,
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error();
			return z
				.object({ access_token: z.string().min(1), token_type: z.literal("bearer") })
				.parse(await response.json()).access_token;
		} catch {
			throw new Error("GitHub authentication unavailable");
		}
	}
	async fetchUserDetails(token: string): Promise<AuthedUserDetails> {
		try {
			const response = await this.request("https://api.github.com/user", {
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": "2022-11-28",
					"User-Agent": "homelab-paas",
				},
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error();
			return { userId: z.object({ login: z.string().min(1) }).parse(await response.json()).login };
		} catch {
			throw new Error("GitHub authentication unavailable");
		}
	}
}
