import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests",
	fullyParallel: false,
	use: { baseURL: "http://127.0.0.1:5174", viewport: { width: 1280, height: 900 } },
	webServer: { command: "pnpm dev", url: "http://127.0.0.1:5174", reuseExistingServer: false },
	outputDir: "../../../../artifacts/forge-browser",
	reporter: "list",
});
