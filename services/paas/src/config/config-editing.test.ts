import type { JsonValue } from "@homelab-paas/shared-contracts";
import { expect, test, vi } from "vitest";

import { ChangeBus } from "../events/change-bus.ts";
import { createTestPaasConfig, testConfigValue } from "../util/test/config.ts";
import { PaasConfig } from "./paas-config.ts";

test("publishes validated configuration changes and avoids restarting live streams for unchanged reloads", async () => {
	const changes = new ChangeBus();
	const receive = vi.fn();
	changes.subscribe(receive);
	let value: unknown = testConfigValue();
	let revision = "r1";
	const config = new PaasConfig(
		{
			read: async () => ({ value, revision }),
			write: async (next) => {
				value = next;
				revision = "saved";
				return { value, revision };
			},
		},
		{},
		changes,
	);
	await config.load();
	await config.reload();
	expect(receive).toHaveBeenCalledTimes(1);
	await config.updateConfig({ revision, changes: [{ path: "git.pollIntervalSeconds", value: 6 }] });
	expect(receive).toHaveBeenCalledTimes(2);
	value = { ...testConfigValue(), services: { demo: { remote: "https://example.com/repo" } } };
	revision = "external";
	await config.reload();
	expect(receive).toHaveBeenCalledTimes(3);
	value = {};
	revision = "invalid";
	await config.reload();
	expect(receive).toHaveBeenCalledTimes(3);
});

test("completed configuration/log redaction masks URL credentials before overlapping known secrets change URL syntax", async () => {
	const config = createTestPaasConfig(async () => JSON.stringify(testConfigValue()));
	await config.load();
	expect(config.redact("https://alice:password@host/path\n", ["http"])).not.toContain("password");
	expect(config.redact("plain ending h", ["http"])).toBe("plain ending h");
	expect(config.redact("http://alpha:p@ss@host/path?q=public@value")).toBe(
		"http://[redacted]@host/path?q=public@value",
	);
});

test("service token edits preserve redacted tokens, support replacement and removal, and remain editable", async () => {
	const f = await fixture();
	const save = (services: Record<string, JsonValue>) =>
		f.config.updateConfig({
			revision: f.config.getEditableConfig().revision,
			changes: [{ path: "services", value: services }],
		});
	await save({ demo: { remote: "https://example.com/repo", accessToken: "repo-private-token" } });
	expect(f.config.redact("failure repo-private-token")).toBe("failure [redacted]");
	expect(JSON.stringify(f.config.getEditableConfig())).not.toContain("repo-private-token");
	expect(f.config.getEditableConfig().fields.find((field) => field.path === "services")?.readOnly).toBe(false);
	await save({ demo: { remote: "https://example.com/repo", accessToken: "[redacted]", branch: "release" } });
	expect(f.config.getServices()["demo"]?.accessToken).toBe("repo-private-token");
	await expect(
		save({ demo: { remote: "https://other.example/repo", accessToken: "[redacted]" } }),
	).rejects.toMatchObject({ kind: "invalid" });
	await save({ demo: { remote: "https://example.com/repo", accessToken: "new-repo-token" } });
	expect(f.config.getServices()["demo"]?.accessToken).toBe("new-repo-token");
	await save({ demo: { remote: "https://example.com/repo" } });
	expect(f.config.getServices()["demo"]?.accessToken).toBeUndefined();
	await expect(
		save({ other: { remote: "https://evil.example/repo", accessToken: "[redacted]" } }),
	).rejects.toMatchObject({ kind: "invalid" });
});

const fixture = async (environment: Record<string, string> = {}) => {
	let content = JSON.stringify(testConfigValue());
	const write = vi.fn(async (_path: string, data: string | Uint8Array) => {
		content = String(data);
	});
	const config = createTestPaasConfig(async () => content, environment, write);
	await config.load();
	return {
		config,
		write,
		disk: () => content,
		replace: (value: string) => {
			content = value;
		},
	};
};

test("configuration owns redacted snapshots and replacement-only secret metadata", async () => {
	const { config } = await fixture();
	const snapshot = config.getEditableConfig();
	expect(snapshot.config).toMatchObject({ auth: { github: { clientSecret: "[redacted]" } } });
	expect(snapshot.fields.find((field) => field.path === "auth.session.signingKey")).toMatchObject({
		kind: "secret",
		configured: true,
	});
	expect(JSON.stringify(snapshot)).not.toContain("a".repeat(32));
	expect(config.redact("Bearer token and secret")).toBe("Bearer [redacted] and [redacted]");
	snapshot.fields.length = 0;
	expect(config.getEditableConfig().fields.length).toBeGreaterThan(0);
});

test("save persists YAML before publishing state and preserves untouched credentials", async () => {
	const f = await fixture();
	const snapshot = f.config.getEditableConfig();
	const saved = await f.config.updateConfig({
		revision: snapshot.revision,
		changes: [
			{ path: "git.pollIntervalSeconds", value: 17 },
			{ path: "auth.github.clientSecret", value: "replacement-secret" },
		],
	});
	expect(f.write).toHaveBeenCalledWith("/etc/homelab-paas/config.yaml", expect.any(String), { mode: 0o600 });
	expect(f.disk()).toContain("replacement-secret");
	expect(f.config.getGitConfig().pollIntervalSeconds).toBe(17);
	expect(f.config.getAuthConfig()?.session.signingKey).toBe("a".repeat(32));
	expect(JSON.stringify(saved)).not.toContain("replacement-secret");
	await f.config.reload();
	expect(f.config.getGitConfig().pollIntervalSeconds).toBe(17);
});

test("failed persistence and invalid, restart-required or environment-managed edits retain disk and state", async () => {
	const f = await fixture({ ACME_EMAIL: "managed@example.test" });
	const snapshot = f.config.getEditableConfig();
	for (const change of [
		{ path: "git.pollIntervalSeconds", value: 0 },
		{ path: "metadata.clusterId", value: "changed" },
		{ path: "tls.acme.email", value: "other@example.test" },
		{ path: "__proto__.polluted", value: true },
		{ path: "auth.github.clientSecret", value: "" },
	]) {
		await expect(f.config.updateConfig({ revision: snapshot.revision, changes: [change] })).rejects.toMatchObject({
			kind: "invalid",
		});
	}
	expect(f.write).not.toHaveBeenCalled();
	f.write.mockRejectedValueOnce(new Error("disk secret failure"));
	await expect(
		f.config.updateConfig({
			revision: snapshot.revision,
			changes: [{ path: "git.pollIntervalSeconds", value: 8 }],
		}),
	).rejects.toMatchObject({ kind: "unavailable" });
	expect(f.config.getEditableConfig()).toEqual(snapshot);
});

test("stale and externally modified configurations cannot overwrite newer settings", async () => {
	const f = await fixture();
	const snapshot = f.config.getEditableConfig();
	const update = { revision: snapshot.revision, changes: [{ path: "git.pollIntervalSeconds", value: 8 }] };
	const results = await Promise.allSettled([f.config.updateConfig(update), f.config.updateConfig(update)]);
	expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
	const current = f.config.getEditableConfig();
	f.replace(JSON.stringify({ ...testConfigValue(), git: { pollIntervalSeconds: 99, operationTimeoutSeconds: 60 } }));
	await expect(f.config.updateConfig({ ...update, revision: current.revision })).rejects.toMatchObject({
		kind: "conflict",
	});
	expect(f.write).toHaveBeenCalledTimes(1);
});

test("environment values never get copied into YAML when saving another field", async () => {
	const f = await fixture({ GITHUB_CLIENT_SECRET: "environment-only-secret" });
	const snapshot = f.config.getEditableConfig();
	expect(snapshot.fields.find((field) => field.path === "auth.github.clientSecret")).toMatchObject({
		managedByEnvironment: true,
		readOnly: true,
	});
	await f.config.updateConfig({
		revision: snapshot.revision,
		changes: [{ path: "git.pollIntervalSeconds", value: 9 }],
	});
	expect(f.disk()).not.toContain("environment-only-secret");
	expect(f.config.getAuthConfig()?.github.clientSecret).toBe("environment-only-secret");
});

test("the service rejects empty edits and duplicate paths regardless of its entry point", async () => {
	const f = await fixture();
	const revision = f.config.getEditableConfig().revision;
	await expect(f.config.updateConfig({ revision, changes: [] })).rejects.toMatchObject({ kind: "invalid" });
	await expect(
		f.config.updateConfig({
			revision,
			changes: [
				{ path: "git.pollIntervalSeconds", value: 8 },
				{ path: "git.pollIntervalSeconds", value: 9 },
			],
		}),
	).rejects.toMatchObject({ kind: "invalid" });
	expect(f.write).not.toHaveBeenCalled();
});

test("getters retain the previous settings until persistence finishes and a queued reload reads the saved values", async () => {
	const f = await fixture();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const original = f.write.getMockImplementation()!;
	f.write.mockImplementationOnce(async (...args) => {
		await gate;
		await original(...args);
	});
	const save = f.config.updateConfig({
		revision: f.config.getEditableConfig().revision,
		changes: [{ path: "git.pollIntervalSeconds", value: 29 }],
	});
	const reload = f.config.reload();
	await vi.waitFor(() => expect(f.write).toHaveBeenCalledTimes(1));
	expect(f.config.getGitConfig().pollIntervalSeconds).toBe(5);
	release();
	await Promise.all([save, reload]);
	expect(f.config.getGitConfig().pollIntervalSeconds).toBe(29);
});
