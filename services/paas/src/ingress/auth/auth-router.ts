import Router from "@koa/router";

import type { IAuthService } from "./auth-service.ts";
import { AuthenticationError } from "./auth-service.ts";

const sessionCookie = "__Secure-paas_session";
const stateCookie = "__Host-paas_oauth";

export const createAuthRouter = (
	auth: IAuthService,
	config: { baseDomain: string; httpsPort: number; ttlSeconds: number; serviceIds: string[] },
) => {
	const authority = (host: string) => `${host}${config.httpsPort === 443 ? "" : `:${config.httpsPort}`}`;
	const authAuthority = authority(`auth.${config.baseDomain}`);
	const managementAuthority = authority(config.baseDomain);
	const serviceAuthorities = new Map(config.serviceIds.map((id) => [authority(`${id}.${config.baseDomain}`), id]));
	const cookieParts = (header: string) =>
		header
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean);
	const cookie = (header: string, name: string) => {
		const matches = cookieParts(header).filter((part) => part.split("=").at(0) === name);
		return matches.length === 1 ? matches.at(0)?.slice(name.length + 1) : undefined;
	};
	const validTarget = (value: unknown): string | undefined => {
		if (typeof value !== "string") return undefined;
		try {
			const url = new URL(value);
			return url.protocol === "https:"
				&& !url.username
				&& !url.password
				&& (serviceAuthorities.has(url.host) || url.host === managementAuthority)
				? url.href
				: undefined;
		} catch {
			return undefined;
		}
	};
	return new Router()
		.all(/^\/auth\/check(?:\/.*)?$/, async (ctx) => {
			ctx.set("Cache-Control", "no-store");
			const serviceId = serviceAuthorities.get(ctx.get("host"));
			const management = ctx.get("host") === managementAuthority;
			if (!serviceId && !management) {
				ctx.status = 403;
				return;
			}
			try {
				const token = cookie(ctx.get("cookie"), sessionCookie);
				const decision = management
					? auth.verifyAuthCookie(token)
						? "allowed"
						: "login"
					: await auth.authorize(serviceId!, token);
				if (decision === "missing") {
					ctx.status = 403;
					return;
				}
				if (decision === "login") {
					const path = ctx.originalUrl.slice("/auth/check".length);
					if (!path.startsWith("/") || path.startsWith("//")) {
						ctx.status = 403;
						return;
					}
					ctx.redirect(
						`https://${authAuthority}/oauth/github/login?redirect_uri=${encodeURIComponent(`https://${ctx.get("host")}${path}`)}`,
					);
					return;
				}
				ctx.set(
					"cookie",
					management
						? ctx.get("cookie")
						: cookieParts(ctx.get("cookie"))
								.filter((part) => ![sessionCookie, stateCookie].includes(part.split("=").at(0) ?? ""))
								.join("; "),
				);
				ctx.status = 200;
			} catch {
				ctx.status = 503;
			}
		})
		.get("/oauth/github/login", (ctx) => {
			ctx.set("Cache-Control", "no-store");
			if (ctx.get("host") !== authAuthority) {
				ctx.status = 404;
				return;
			}
			const target = validTarget(ctx.query["redirect_uri"]);
			if (!target) {
				ctx.status = 400;
				return;
			}
			const login = auth.beginLogin(target);
			ctx.set("Set-Cookie", `${stateCookie}=${login.nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
			ctx.set("Referrer-Policy", "no-referrer");
			ctx.redirect(login.url);
		})
		.get("/auth/callback", async (ctx) => {
			ctx.set("Cache-Control", "no-store");
			ctx.set("Referrer-Policy", "no-referrer");
			if (ctx.get("host") !== authAuthority) {
				ctx.status = 404;
				return;
			}
			ctx.set("Set-Cookie", `${stateCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
			const { code, state } = ctx.query;
			if (typeof code !== "string" || typeof state !== "string" || !code || !state) {
				ctx.status = 400;
				return;
			}
			try {
				const result = await auth.completeLogin(code, state, cookie(ctx.get("cookie"), stateCookie));
				const target = validTarget(result.redirectUri);
				if (!target) {
					ctx.status = 400;
					return;
				}
				ctx.append(
					"Set-Cookie",
					`${sessionCookie}=${result.session}; Domain=${config.baseDomain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${config.ttlSeconds}`,
				);
				ctx.redirect(target);
			} catch (error) {
				ctx.status = error instanceof AuthenticationError ? 403 : 503;
			}
		});
};
