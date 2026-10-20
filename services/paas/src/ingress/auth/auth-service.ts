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
		private readonly allowedUsers: string[],
		private readonly generateNonce: () => string,
		private readonly endpoints: IEndpointsStore,
		private readonly ingress: { baseDomain: string; httpsPort: number },
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
		} catch {
			throw new AuthenticationError();
		}
	}
	verifyAuthCookie(token: string | undefined): AuthedUserDetails | undefined {
		const userId = this.tokens.verify(token, "session")?.userId;
		return userId && this.isAllowed(userId) ? { userId } : undefined;
	}
	private isAllowed(userId: string): boolean {
		return this.allowedUsers.some((allowed) => allowed.toLowerCase() === userId.toLowerCase());
	}
	private callbackUrl(): string {
		const port = this.ingress.httpsPort === 443 ? "" : `:${this.ingress.httpsPort}`;
		return `https://auth.${this.ingress.baseDomain}${port}/auth/callback`;
	}
}

export class AuthenticationError extends Error {
	constructor() {
		super("Authentication failed");
		this.name = "AuthenticationError";
	}
}
