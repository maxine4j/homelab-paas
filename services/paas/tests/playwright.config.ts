import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	globalSetup: "./image-setup.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	outputDir: "../../../artifacts/playwright/results",
	reporter: [["list"], ["html", { outputFolder: "../../../artifacts/playwright/report", open: "never" }]],
	use: { browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
