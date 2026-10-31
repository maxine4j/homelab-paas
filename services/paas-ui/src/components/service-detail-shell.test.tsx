import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ServiceDetailShell } from "./service-detail-shell.tsx";

test.each(["overview", "resources", "descriptor", "events", "secrets"] as const)(
	"%s keeps both revision panels visible while the service snapshot loads",
	(tab) => {
		const html = renderToStaticMarkup(
			<ServiceDetailShell serviceId='demo' tab={tab}>
				<p>Tab content</p>
			</ServiceDetailShell>,
		);
		expect(html).toContain("Active revision");
		expect(html).toContain("Desired revision");
		expect(html.match(/Loading…/g)).toHaveLength(2);
		expect(html).not.toContain("Not deployed");
		expect(html).toContain("Tab content");
	},
);
