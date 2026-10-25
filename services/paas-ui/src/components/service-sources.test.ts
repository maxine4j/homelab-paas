import { expect, test } from "vitest";

import { readServiceSources, saveServiceSources } from "./service-sources.ts";

test("service forms preserve remote and local sources and omit an empty optional branch", () => {
	const value = {
		web: { remote: "https://github.com/example/web.git", branch: "main", descriptorPath: "web.sd.yaml" },
		local: { remote: "local", descriptorPath: "/mnt/repo/local.sd.yaml" },
	};
	expect(saveServiceSources(readServiceSources(value))).toEqual(value);
	expect(saveServiceSources([])).toEqual({});
});

test("service forms reject duplicate and invalid IDs without silently dropping entries", () => {
	const row = { serviceId: "web", remote: "local", branch: "", descriptorPath: "/repo/web.sd.yaml" };
	expect(() => saveServiceSources([row, row])).toThrow("Duplicate service ID");
	expect(() => saveServiceSources([{ ...row, serviceId: "Invalid ID" }])).toThrow("lowercase kebab case");
	expect(() => saveServiceSources([{ ...row, remote: "" }])).toThrow("Repository is required");
	expect(() => saveServiceSources([{ ...row, descriptorPath: "" }])).toThrow("Descriptor path is required");
	expect(() => saveServiceSources([{ ...row, descriptorPath: "relative.yaml" }])).toThrow("absolute");
});
