import { test, expect } from "../util/browser-fixtures.ts";

test("wrapped service actions share the full row while wide headings keep compact actions", async ({
	environment: env,
	page,
}) => {
	await page.goto(env.url("", "/#/services/public"));
	const heading = page.locator(".service-identity-block");
	await expect(heading.getByRole("button", { name: "Redeploy", exact: true })).toBeVisible();
	await expect(heading.getByLabel("Health: Healthy", { exact: true })).toBeVisible();
	for (const width of [320, 390, 600, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await heading.getByRole("heading").evaluate(
			(element, name) => {
				element.textContent = name;
			},
			width === 600 ? "public-service-with-a-long-name" : "public",
		);
		const layout = await heading.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			const identity = element.querySelector(".service-identity")!.getBoundingClientRect();
			const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
			const [refresh, redeploy] = buttons;
			return {
				left: bounds.left,
				right: bounds.right,
				identityBottom: identity.bottom,
				refresh: { left: refresh!.left, top: refresh!.top, width: refresh!.width },
				redeploy: { right: redeploy!.right, top: redeploy!.top, width: redeploy!.width },
				gap: redeploy!.left - refresh!.right,
				pageFits: document.documentElement.scrollWidth <= window.innerWidth,
			};
		});
		expect(layout.pageFits).toBe(true);
		expect(layout.refresh.width).toBeCloseTo(layout.redeploy.width, 0);
		expect(layout.refresh.top).toBe(layout.redeploy.top);
		expect(layout.gap).toBe(12);
		expect(layout.left).toBeGreaterThanOrEqual(20);
		expect(width - layout.right).toBeGreaterThanOrEqual(20);
		if (width < 1280) {
			expect(layout.refresh.top).toBeGreaterThanOrEqual(layout.identityBottom + 8);
			expect(layout.refresh.left).toBeCloseTo(layout.left, 0);
			expect(layout.redeploy.right).toBeCloseTo(layout.right, 0);
		} else {
			expect(layout.refresh.top).toBeLessThan(layout.identityBottom);
			expect(layout.refresh.width).toBeLessThan(160);
		}
	}
});
