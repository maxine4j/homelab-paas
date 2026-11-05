import { defineConfig } from "@playwright/test";
const port = Number(process.env["FORGE_BROWSER_PORT"] ?? "5176");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid FORGE_BROWSER_PORT");
export default defineConfig({
	testDir: "tests",
	fullyParallel: false,
	use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 } },
	webServer: {
		command: `pnpm dev --mode test --host 127.0.0.1 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
	},
	outputDir: "../../../../artifacts/forge-browser",
	reporter: "list",
});
