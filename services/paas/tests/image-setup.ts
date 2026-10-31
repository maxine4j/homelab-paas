import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ImageRetention } from "./util/image-retention.ts";

const execute = promisify(execFile);

/** Resolve once before Playwright forks workers, including replacement workers after failures. */
export default async (): Promise<void> => {
	const images = new ImageRetention("", async (args) => (await execute("docker", args)).stdout);
	const variables = ["PAAS_IMAGE", "TEST_SERVICE_IMAGE", "PLAYWRIGHT_IMAGE"];
	const ids = await images.resolve([
		process.env["PAAS_IMAGE"] ?? "homelab-paas/paas:ci",
		process.env["TEST_SERVICE_IMAGE"] ?? "homelab-paas/test-service:ci",
		process.env["PLAYWRIGHT_IMAGE"] ?? "homelab-paas/playwright:ci",
	]);
	for (const [index, variable] of variables.entries()) process.env[variable] = ids.at(index)!;
};
