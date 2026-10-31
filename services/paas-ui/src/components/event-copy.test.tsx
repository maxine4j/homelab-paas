import type { UiServiceEvent } from "@homelab-paas/shared-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { copyEventJson } from "./event-copy.tsx";
import { ServiceEvents } from "./service-events.tsx";

const event: UiServiceEvent = {
	timestamp: 1,
	event: "reconciliation.failed",
	level: "error",
	message: "Failed",
	diagnostics: "Complete diagnostic context",
	resourceId: "app",
};

test("event cards offer a copy control and copy the complete event JSON", async () => {
	const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
	expect(renderToStaticMarkup(<ServiceEvents events={[event]} />)).toContain("Copy JSON</button>");
	expect(await copyEventJson(event, { writeText })).toBe("Copied JSON");
	expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(event, undefined, 2));
});

test("clipboard failures provide safe feedback and allow another attempt", async () => {
	const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce(new Error("private context"));
	expect(await copyEventJson(event, { writeText })).toBe("Unable to copy JSON");
	writeText.mockResolvedValueOnce();
	expect(await copyEventJson(event, { writeText })).toBe("Copied JSON");
	expect(await copyEventJson(event, undefined)).toBe("Unable to copy JSON");
});
