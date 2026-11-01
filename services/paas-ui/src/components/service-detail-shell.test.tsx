import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServiceDetailShell } from "./service-detail-shell.tsx";

test.each(["overview", "resources", "descriptor", "events", "secrets"] as const)(
	"%s keeps the shared heading free of revisions while the service snapshot loads",
	(tab) => {
		const html = renderToStaticMarkup(
			<ServiceDetailShell serviceId='demo' tab={tab}>
				<p>Tab content</p>
			</ServiceDetailShell>,
		);
		expect(html).not.toContain("Active revision");
		expect(html).not.toContain("Desired revision");
		expect(html).not.toContain("Not deployed");
		expect(html).toContain("Tab content");
	},
);
