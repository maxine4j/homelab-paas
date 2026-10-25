import { chromium, test as base, expect } from "@playwright/test";

import { ContainerEnvironment } from "./container-environment.ts";
import { captureDiagnostics } from "./diagnostics.ts";

export const test = base.extend<{ environment: ContainerEnvironment; production: boolean }>({
	production: [false, { option: true }],
	environment: async ({ production }, use, info) => {
		const environment = new ContainerEnvironment();
		try {
			await environment.start(production);
			await use(environment);
		} finally {
			try {
				await captureDiagnostics(environment);
				await info.attach("cluster", { body: environment.directory, contentType: "text/plain" });
			} finally {
				await environment.close();
			}
		}
	},
	context: async ({ environment }, use) => {
		const browser = await chromium.connect(await environment.startBrowser());
		const context = await browser.newContext();
		try {
			await use(context);
		} finally {
			await context.close();
			await browser.close();
		}
	},
});

export { expect };
