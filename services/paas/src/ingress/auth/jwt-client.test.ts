import jwt from "jsonwebtoken";
import { expect, test } from "vitest";

import { testConfig } from "../../util/test/config.ts";
import { JwtClient } from "./jwt-client.ts";

test("validates algorithm, issuer, audience, expiration, purpose and user payload", () => {
	const config = { issuer: "issuer", audience: "audience", signingKey: "a".repeat(32), ttlSeconds: 60 };
	const client = new JwtClient(
		testConfig({ auth: { ...testConfig().getAuthConfig()!, session: config } }),
		() => 10_000,
	);
	const valid = { iss: "issuer", aud: "audience", exp: 70, purpose: "session", userId: "alice" };
	for (const change of [{ iss: "other" }, { aud: "other" }, { exp: 10 }, { purpose: "state" }, { userId: 42 }]) {
		expect(
			client.verify(jwt.sign({ ...valid, ...change }, config.signingKey, { algorithm: "HS256" }), "session"),
		).toBeUndefined();
	}
	const { exp: _exp, ...withoutExpiry } = valid;
	expect(client.verify(jwt.sign(withoutExpiry, config.signingKey), "session")).toBeUndefined();
	expect(client.verify(jwt.sign(valid, config.signingKey, { algorithm: "HS384" }), "session")).toBeUndefined();
	expect(client.verify(jwt.sign(valid, "other"), "session")).toBeUndefined();
});
