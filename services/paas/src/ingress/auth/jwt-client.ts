import jwt from "jsonwebtoken";
import { z } from "zod";

import type { IPaasConfig } from "../../config/paas-config.ts";
import type { TokenClaims } from "./types.ts";
export interface IJwtClient {
	issue(claims: TokenClaims, purpose: "session" | "state"): string;
	verify(token: string | undefined, purpose: "session" | "state"): TokenClaims | undefined;
}
export class JwtClient implements IJwtClient {
	constructor(
		private readonly config: IPaasConfig,
		private readonly now: () => number,
	) {}
	issue(claims: TokenClaims, purpose: "session" | "state"): string {
		const session = this.config.getAuthConfig()!.session;
		return jwt.sign({ ...claims, purpose, iat: Math.floor(this.now() / 1000) }, session.signingKey, {
			algorithm: "HS256",
			issuer: session.issuer,
			audience: session.audience,
			expiresIn: purpose === "session" ? session.ttlSeconds : 600,
		});
	}
	verify(token: string | undefined, purpose: "session" | "state"): TokenClaims | undefined {
		if (!token) return undefined;
		try {
			const session = this.config.getAuthConfig()!.session;
			const payload = jwt.verify(token, session.signingKey, {
				algorithms: ["HS256"],
				issuer: session.issuer,
				audience: session.audience,
				clockTimestamp: Math.floor(this.now() / 1000),
			});
			const common = z.object({ purpose: z.literal(purpose), exp: z.number().finite() });
			return purpose === "session"
				? { userId: common.extend({ userId: z.string().min(1) }).parse(payload).userId }
				: common.extend({ nonce: z.string().min(1), redirectUri: z.string().min(1) }).parse(payload);
		} catch {
			return undefined;
		}
	}
}
