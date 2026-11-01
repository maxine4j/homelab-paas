import { expect, test, vi } from "vitest";

import { testConfig } from "../util/test/config.ts";
import { StaticService } from "./static-service.ts";

test("serves only published static hostnames and the selected primary alias", async () => {
	const read = vi.fn(async () => new Uint8Array([1, 2]));
	const service = new StaticService(
		testConfig({ ingress: { baseDomain: "example.com", httpPort: 80 } }),
		{
			getAll: async () => ({
				"site.demo": { address: "127.0.0.1", port: 8081, public: true, primary: true, static: true },
				"web.demo": { address: "10.0.0.1", port: 80, public: true },
			}),
		},
		{ read },
	);
	for (const host of ["site.demo.example.com", "demo.example.com", "site.demo.example.com:443"])
		expect(await service.resolve(host, "/")).toMatchObject({ kind: "file", path: "index.html" });
	expect(read).toHaveBeenLastCalledWith("demo", "site", "index.html");
	for (const host of ["example.com", "web.demo.example.com", "other.demo.example.com", "demo.example.com.attacker"])
		expect(await service.resolve(host, "/api/ui/cluster")).toEqual({ kind: "missing" });
	for (const path of ["/../index.html", "/a/../../file", "/a\\b", "/a\0b", "//index.html"])
		expect(await service.resolve("site.demo.example.com", path)).toEqual({ kind: "missing" });
	read.mockClear();
	expect(await service.resolve("site.demo.example.com", "/docs/")).toMatchObject({
		kind: "file",
		path: "docs/index.html",
	});
	expect(read).toHaveBeenLastCalledWith("demo", "site", "docs/index.html");
});
