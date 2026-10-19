// Run explicitly inside the packaged Linux image, with /tmp as a writable tmpfs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import { createHttpServer } from "/opt/homelab-paas/dist/start.js";

const deadline = setTimeout(() => {
	throw new Error("packaged runtime smoke test timed out");
}, 15_000);
deadline.unref();

const processServer = spawn(process.execPath, ["dist/main.js"], {
	cwd: "/opt/homelab-paas",
	env: { ...process.env, PAAS_LISTEN: "127.0.0.1:0" },
	stdio: ["ignore", "pipe", "inherit"],
});
const exited = once(processServer, "exit");
const lines = createInterface({ input: processServer.stdout });
try {
	let address;
	for await (const line of lines) {
		const match = /http:\/\/127\.0\.0\.1:\d+/.exec(line);
		if (match) {
			address = match.at(0);
			break;
		}
	}
	assert.ok(address, "packaged listener must start");
	assert.equal((await fetch(`${address}/api/health`)).status, 200);
	processServer.kill("SIGTERM");
	assert.equal((await exited).at(0), 0, "SIGTERM must drain and exit cleanly");
} finally {
	lines.close();
	processServer.kill("SIGKILL");
	await exited;
}

const app = createHttpServer({
	uiDirectory: "/usr/share/homelab-paas/ui",
	logLevel: "silent",
	listen: { host: "127.0.0.1", port: 0 },
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const request = (path) => fetch(`http://127.0.0.1:${address.port}${path}`);
try {
	assert.equal((await request("/api/health")).status, 200);
	assert.equal((await request("/services/example")).status, 200);
	assert.deepEqual(await (await request("/api/missing")).json(), {
		code: "not_found",
		diagnostics: [],
	});
	assert.match(await (await request("/")).text(), /\/assets\//);
} finally {
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

console.log("Packaged HTTP routes and graceful shutdown smoke test passed.");
