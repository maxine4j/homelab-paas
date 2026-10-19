import { afterEach, describe, expect, it, vi } from "vitest";

import { checkHealth } from "./health";

afterEach(() => vi.unstubAllGlobals());
describe("healthcheck", () => {
	it("reports up only for HTTP 200", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		expect(await checkHealth()).toBe("up");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
		expect(await checkHealth()).toBe("down");
	});
	it("reports down for an unreachable backend", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
		expect(await checkHealth()).toBe("down");
	});
});
