import { expect, test } from "vitest";

import { readServiceSources, saveServiceSources, changeRepository } from "./service-sources.ts";

test("credential drafts preserve saved token markers and discard credentials when the repository changes", () => {
	const sources = {
		demo: { remote: "https://example.com/repo", descriptorPath: "file.yaml", accessToken: "[redacted]" },
		ssh: { remote: "git@example.com:repo", descriptorPath: "ssh.yaml", privateKeyPath: "/keys/ssh" },
	};
	expect(saveServiceSources(readServiceSources(sources))).toEqual(sources);
	const row = readServiceSources(sources)[0]!;
	expect(saveServiceSources([{ ...row, accessToken: "replacement" }])).toMatchObject({
		demo: { accessToken: "replacement" },
	});
	expect(saveServiceSources([changeRepository(row, "ssh://git@example.com/repo")])).toEqual({
		demo: { remote: "ssh://git@example.com/repo", descriptorPath: "file.yaml" },
	});
	expect(saveServiceSources([{ ...row, accessToken: undefined }])).toEqual({
		demo: { remote: row.remote, descriptorPath: row.descriptorPath },
	});
});

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
