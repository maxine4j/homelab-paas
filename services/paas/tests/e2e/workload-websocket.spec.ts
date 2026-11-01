import { once } from "node:events";

import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";
import { WebSocket } from "ws";

import { test, expect } from "../util/browser-fixtures.ts";

// Use the control-plane image's existing ws dependency as a disposable workload.
const workload = `
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
const server = createServer((_request, response) => {
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify({ status: "up", version: "websocket" }));
});
const sockets = new WebSocketServer({ server });
sockets.on("connection", (socket, request) => {
	socket.send(JSON.stringify({ cookie: request.headers.cookie ?? "" }));
	socket.on("message", (message) => socket.send(message.toString()));
});
server.listen(8080, "0.0.0.0");
`;

test("workload WebSockets authenticate private handshakes, preserve public policy and strip platform cookies", async ({
	environment: env,
}) => {
	await env.git.commit(
		Object.fromEntries(
			["private", "public"].map((serviceId) => [
				`${serviceId}.sd.yaml`,
				JSON.stringify({
					version: 1,
					metadata: { serviceId },
					resources: {
						app: {
							type: "web",
							image: env.paasImage,
							command: ["node", "--input-type=module", "-e", workload],
							healthcheckUrl: "/health",
							ingress: { port: 8080, public: serviceId === "public" },
							termination: { timeoutSeconds: 2 },
						},
					},
				} satisfies ServiceDescriptor),
			]),
		),
	);
	await Promise.all([env.waitReady("private", "websocket"), env.waitReady("public", "websocket")]);
	const connect = (host: string, cookie: string) =>
		new WebSocket(env.url(host, "/socket").replace(/^http/, "ws"), {
			ca: env.ca,
			family: 4,
			lookup: (_host, _options, callback) => callback(null, "127.0.0.1", 4),
			headers: { cookie },
			followRedirects: false,
			handshakeTimeout: 5000,
		});
	const rejected = (host: string, cookie: string): Promise<number | undefined> =>
		new Promise((resolve, reject) => {
			const socket = connect(host, cookie);
			socket.on("error", reject);
			socket.on("open", () => {
				socket.terminate();
				reject(new Error("Unauthorized WebSocket opened"));
			});
			socket.on("unexpected-response", (_request, response) => {
				response.resume();
				socket.terminate();
				resolve(response.statusCode);
			});
		});
	for (const cookie of [
		"",
		"__Secure-paas_session=invalid",
		`__Secure-paas_session=${env.session("Mallory")}`,
		`__Secure-paas_session=${env.session("Alice", Date.now() - 3601_000)}`,
		`__Secure-paas_session=${env.session()}; __Secure-paas_session=${env.session()}`,
	]) {
		expect(await rejected("private", cookie)).toBe(302);
	}
	for (const [host, cookie] of [
		["private", `app=keep; __Secure-paas_session=${env.session()}; __Host-paas_oauth=nonce`],
		["app.private", `app=keep; __Secure-paas_session=${env.session()}`],
		["public", "app=keep; __Secure-paas_session=invalid; __Host-paas_oauth=nonce"],
		["app.public", "app=keep"],
	] as const) {
		const socket = connect(host, cookie);
		try {
			const initial = once(socket, "message");
			await once(socket, "open");
			expect(JSON.parse(String((await initial).at(0)))).toEqual({ cookie: "app=keep" });
			const echo = once(socket, "message");
			socket.send("workload message");
			expect(String((await echo).at(0))).toBe("workload message");
		} finally {
			socket.terminate();
		}
	}
	await env.compose(["pause", "paas"]);
	try {
		expect(await rejected("public", "")).toBe(403);
	} finally {
		await env.compose(["unpause", "paas"]);
	}
});
