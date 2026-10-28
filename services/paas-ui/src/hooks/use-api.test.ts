import { expect, test } from "vitest";

import { mergeApiResult } from "./use-api.ts";

test("connection-only updates preserve same-view snapshots during explicit resubscription, but never retain another path", () => {
	const previous = { path: "/cluster", data: { revision: "saved" }, connected: true };
	expect(mergeApiResult("/cluster", previous, { connected: true, data: undefined })).toMatchObject({
		data: { revision: "saved" },
	});
	expect(mergeApiResult("/services", previous, { connected: true, data: undefined }).data).toBeUndefined();
	expect(mergeApiResult("/cluster", previous, { data: { revision: "new" }, connected: true }).data).toEqual({
		revision: "new",
	});
});
