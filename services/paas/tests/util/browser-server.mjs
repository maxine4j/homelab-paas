import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { mkdir } from "../../src/util/file.ts";

// Runs only inside the isolated Linux browser image. Host trust stores are untouched.
const execute = promisify(execFile);
const directory = "/tmp/browser-home/.pki/nssdb";
await mkdir(directory, { recursive: true });
await execute("certutil", ["-N", "--empty-password", "-d", `sql:${directory}`]);
await execute("certutil", [
	"-A",
	"-d",
	`sql:${directory}`,
	"-n",
	"paas-test-ca",
	"-t",
	"C,,",
	"-i",
	"/test-state/tls/ca.pem",
]);
const domain = process.env["TEST_DOMAIN"];
const address = process.env["ENVOY_ADDRESS"];
const server = await chromium.launchServer({
	host: "0.0.0.0",
	port: 3000,
	env: { ...process.env, HOME: "/tmp/browser-home" },
	args: [`--host-resolver-rules=MAP ${domain} ${address}, MAP *.${domain} ${address}`, "--no-proxy-server"],
});
console.log(server.wsEndpoint());
for (const signal of ["SIGTERM", "SIGINT"])
	process.on(signal, async () => {
		await server.close();
		process.exit(0);
	});
