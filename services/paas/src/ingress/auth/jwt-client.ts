import jwt from "jsonwebtoken";
import { z } from "zod";

import type { SessionConfig, TokenClaims } from "./types.ts";
export interface IJwtClient {
	issue(claims: TokenClaims, purpose: "session" | "state"): string;
	verify(token: string | undefined, purpose: "session" | "state"): TokenClaims | undefined;
}
export class JwtClient implements IJwtClient {
	constructor(
		private readonly config: SessionConfig,
		private readonly now: () => number,
	) {}
	issue(claims: TokenClaims, purpose: "session" | "state"): string {
		return jwt.sign({ ...claims, purpose, iat: Math.floor(this.now() / 1000) }, this.config.signingKey, {
			algorithm: "HS256",
			issuer: this.config.issuer,
			audience: this.config.audience,
			expiresIn: purpose === "session" ? this.config.ttlSeconds : 600,
		});
	}
	verify(token: string | undefined, purpose: "session" | "state"): TokenClaims | undefined {
		if (!token) return undefined;
		try {
			const payload = jwt.verify(token, this.config.signingKey, {
				algorithms: ["HS256"],
				issuer: this.config.issuer,
				audience: this.config.audience,
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
