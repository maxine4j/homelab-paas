import type { IPaasConfig } from "../../config/paas-config.ts";
import type { IEndpointsStore } from "../../reconciler/networking/endpoints-store.ts";
import type { IJwtClient } from "./jwt-client.ts";
import type { Oauth2Provider } from "./oauth-provider/types.ts";
import type { AuthedUserDetails, AuthorizationDecision, Login, LoginResult } from "./types.ts";
export interface IAuthService {
	/** Returns identity only for authenticated private routes; public routes return allowed without identity.
	 * Checks the published policy and local session. Store failures propagate and must fail closed.
	 */
	authorize(serviceId: string, token: string | undefined): Promise<AuthorizationDecision>;
	beginLogin(redirectUri: string): Login;
	completeLogin(code: string, state: string, nonce: string | undefined): Promise<LoginResult>;
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined;
}
export class AuthService implements IAuthService {
	constructor(
		private readonly provider: Oauth2Provider,
		private readonly tokens: IJwtClient,
		private readonly config: IPaasConfig,
		private readonly generateNonce: () => string,
		private readonly endpoints: IEndpointsStore,
	) {}
	async authorize(serviceId: string, token: string | undefined): Promise<AuthorizationDecision> {
		const endpoints = await this.endpoints.getAll();
		const [, primary] =
			Object.entries(endpoints).find(([id, endpoint]) => id.split(".").at(1) === serviceId && endpoint.primary)
			?? [];
		const endpoint = endpoints[serviceId] ?? primary;
		if (!endpoint) return "missing";
		return endpoint.public === true ? "allowed" : (this.verifyAuthCookie(token) ?? "login");
	}
	beginLogin(redirectUri: string): Login {
		const nonce = this.generateNonce();
		const state = this.tokens.issue({ redirectUri, nonce }, "state");
		return { url: this.provider.getLoginUrl(state, this.callbackUrl()), state, nonce };
	}
	async completeLogin(code: string, state: string, nonce: string | undefined): Promise<LoginResult> {
		try {
			const claims = this.tokens.verify(state, "state");
			if (!code || !nonce || claims?.nonce !== nonce || !claims.redirectUri) throw new Error();
			const accessToken = await this.provider.fetchAccessToken(code, this.callbackUrl());
			const user = await this.provider.fetchUserDetails(accessToken);
			if (!this.isAllowed(user.userId)) throw new Error();
			return { session: this.tokens.issue(user, "session"), redirectUri: claims.redirectUri };
		} catch (cause) {
			throw new AuthenticationError({ cause });
		}
	}
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined {
		const claims = this.tokens.verify(token, "session");
		return claims?.userId && this.isAllowed(claims.userId)
			? {
					userId: claims.userId,
					...(claims.email ? { email: claims.email } : {}),
					...(claims.name ? { name: claims.name } : {}),
				}
			: undefined;
	}
	private isAllowed(userId: string): boolean {
		return this.config
			.getAuthConfig()!
			.github.allowedUsers.some((allowed) => allowed.toLowerCase() === userId.toLowerCase());
	}
	private callbackUrl(): string {
		const { baseDomain, httpsPort } = this.config.getIngressConfig();
		const port = httpsPort === 443 ? "" : `:${httpsPort}`;
		return `https://auth.${baseDomain}${port}/auth/callback`;
	}
}

export class AuthenticationError extends Error {
	constructor(options?: ErrorOptions) {
		super("Authentication failed", options);
		this.name = "AuthenticationError";
	}
}
