import type { IPaasConfig } from "../../config/paas-config.ts";
import type { IEndpointsStore } from "../../reconciler/networking/endpoints-store.ts";
import type { IJwtClient } from "./jwt-client.ts";
import type { Oauth2Provider } from "./oauth-provider/types.ts";
import type { AuthedUserDetails, Login, LoginResult } from "./types.ts";
export interface IAuthService {
	/** Checks the published policy and local session. Store failures propagate and must fail closed. */
	authorize(serviceId: string, token: string | undefined): Promise<"allowed" | "login" | "missing">;
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
	async authorize(serviceId: string, token: string | undefined): Promise<"allowed" | "login" | "missing"> {
		const endpoint = (await this.endpoints.getAll())[serviceId];
		if (!endpoint) return "missing";
		return endpoint.public === true || this.verifyAuthCookie(token) ? "allowed" : "login";
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
			return { session: this.tokens.issue({ userId: user.userId }, "session"), redirectUri: claims.redirectUri };
		} catch (cause) {
			throw new AuthenticationError({ cause });
		}
	}
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined {
		const userId = this.tokens.verify(token, "session")?.userId;
		return userId && this.isAllowed(userId) ? { userId } : undefined;
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
