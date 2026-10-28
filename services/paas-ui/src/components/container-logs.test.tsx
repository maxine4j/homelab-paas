import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ContainerLogs } from "./container-logs.tsx";

test("log viewer provides explicit follow control and accessible log output", () => {
	const html = renderToStaticMarkup(<ContainerLogs content='safe output' />);
	expect(html).toContain("Pause follow");
	expect(html).toContain('aria-label="Container logs"');
	expect(html).toContain("safe output");
});
