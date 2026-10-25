import { randomUUID } from "node:crypto";

import { MockHttpServer } from "../util/http-server.ts";

export class MockGitHub {
	user = "Alice";
	failToken = false;
	failProfile = false;
	private readonly codes = new Map<string, { callback: string; user: string }>();
	private readonly tokens = new Map<string, string>();
	readonly server = new MockHttpServer((request) => {
		const { method, url, headers } = request;
		if (method === "GET" && url.pathname === "/authorize") {
			if (url.searchParams.get("client_id") !== "test-client" || !url.searchParams.get("state"))
				return new Response("Bad authorization parameters", { status: 400 });
			const callback = url.searchParams.get("redirect_uri")!;
			const code = randomUUID();
			this.codes.set(code, { callback, user: this.user });
			const target = new URL(callback);
			target.searchParams.set("state", url.searchParams.get("state")!);
			target.searchParams.set("code", code);
			return Response.redirect(target, 302);
		}
		if (method === "POST" && url.pathname === "/token") {
			if (this.failToken) return new Response("Token unavailable", { status: 503 });
			const body: unknown = JSON.parse(request.body);
			if (!body || typeof body !== "object" || !("code" in body) || typeof body.code !== "string")
				return new Response("Bad exchange", { status: 400 });
			const authorization = this.codes.get(body.code);
			if (
				!authorization
				|| !("redirect_uri" in body)
				|| body.redirect_uri !== authorization.callback
				|| !("client_id" in body)
				|| body.client_id !== "test-client"
				|| !("client_secret" in body)
				|| body.client_secret !== "test-secret"
				|| headers["accept"] !== "application/json"
				|| headers["content-type"] !== "application/json"
			)
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			this.codes.delete(body.code);
			const token = randomUUID();
			this.tokens.set(token, authorization.user);
			return Response.json({ access_token: token, token_type: "bearer" });
		}
		if (method === "GET" && url.pathname === "/user") {
			if (this.failProfile) return new Response("Profile unavailable", { status: 503 });
			const user = this.tokens.get(headers.authorization?.replace(/^Bearer /, "") ?? "");
			if (
				!user
				|| headers["x-github-api-version"] !== "2022-11-28"
				|| headers["user-agent"] !== "homelab-paas"
				|| headers.accept !== "application/vnd.github+json"
			)
				return new Response("Bad profile request", { status: 401 });
			return Response.json({ login: user });
		}
		return undefined;
	});

	endpoints(origin = this.server.url) {
		return { authorization: `${origin}/authorize`, token: `${origin}/token`, profile: `${origin}/user` };
	}
}
