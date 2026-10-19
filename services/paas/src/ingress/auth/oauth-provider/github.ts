import { z } from "zod";

import type { AuthedUserDetails, LoginRequest, Oauth2Provider } from "./types.ts";
import { OauthProviderError } from "./types.ts";

export interface GitHubOauthConfig {
	clientId: string;
	clientSecret: string;
	callbackUrl: string;
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
	id: z.number().int().positive().safe(),
	login: z.string().min(1),
	name: z.string().nullable(),
	avatar_url: z.url().optional(),
});
const emailsSchema = z.array(z.object({ email: z.email(), primary: z.boolean(), verified: z.boolean() }));

/** External-system client: all HTTP and response decoding stays here. */
export class GitHubOauth2Provider implements Oauth2Provider {
	private readonly config: GitHubOauthConfig;
	private readonly request: typeof fetch;
	constructor(config: GitHubOauthConfig, request: typeof fetch) {
		this.config = config;
		this.request = request;
	}

	getLoginUrl({ state, codeChallenge }: LoginRequest): string {
		const url = new URL("https://github.com/login/oauth/authorize");
		url.search = new URLSearchParams({
			response_type: "code",
			client_id: this.config.clientId,
			redirect_uri: this.config.callbackUrl,
			scope: "user:email",
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
		}).toString();
		return url.toString();
	}

	async fetchAccessToken(code: string, codeVerifier: string, signal?: AbortSignal): Promise<string> {
		try {
			const body = await this.json(
				"https://github.com/login/oauth/access_token",
				{
					method: "POST",
					headers: { "Content-Type": "application/json", Accept: "application/json" },
					body: JSON.stringify({
						client_id: this.config.clientId,
						client_secret: this.config.clientSecret,
						code,
						redirect_uri: this.config.callbackUrl,
						code_verifier: codeVerifier,
					}),
				},
				signal,
			);
			return tokenSchema.parse(body).access_token;
		} catch {
			throw new OauthProviderError();
		}
	}

	async fetchUserDetails(accessToken: string, signal?: AbortSignal): Promise<AuthedUserDetails> {
		const options = {
			method: "GET",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${accessToken}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		};
		try {
			const [userBody, emailsBody] = await Promise.all([
				this.json("https://api.github.com/user", options, signal),
				this.json("https://api.github.com/user/emails", options, signal),
			]);
			const user = userSchema.parse(userBody);
			const email = emailsSchema.parse(emailsBody).find((entry) => entry.primary && entry.verified)?.email;
			return {
				userId: String(user.id),
				username: user.login.toLowerCase(),
				...(user.name === null ? {} : { name: user.name }),
				...(user.avatar_url === undefined ? {} : { avatarUrl: user.avatar_url }),
				...(email === undefined ? {} : { email }),
			};
		} catch {
			throw new OauthProviderError();
		}
	}

	private async json(url: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
		const timeout = AbortSignal.timeout(30_000);
		const response = await this.request(url, {
			...options,
			redirect: "error",
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (!response.ok) throw new OauthProviderError();
		return response.json();
	}
}
