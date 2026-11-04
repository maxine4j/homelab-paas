import { expect, test } from "vitest";

import { presentDiagnostics } from "./event-diagnostics.ts";

test("formats mixed cause, error and aggregate chains as multiline stacks", () => {
	const root = {
		stack: "Error: disk full\n    at extract (file:///app/services/paas/dist/docker.js:1:2)",
		code: "ENOSPC",
	};
	const diagnostics = presentDiagnostics(
		JSON.stringify({
			error: {
				stack: "DockerClientError: unavailable\n    at pull",
				cause: { message: "pull failed", error: { errors: [root, "cleanup failed\n    at cleanup"] } },
				kind: "unavailable",
			},
			contextYaml: "image: app:1\n",
		}),
	);
	expect(diagnostics.stack).toContain(
		"Caused by:\npull failed\n\nCaused by:\nRelated errors:\nError: disk full\n    at extract (dist/docker.js:1:2)",
	);
	expect(diagnostics.stack).toContain('Provider details:\n{\n  "code": "ENOSPC"\n}');
	expect(diagnostics.stack).toContain("cleanup failed\n    at cleanup");
	expect(diagnostics.stack).not.toContain("\\n");
	expect(diagnostics.context).toBe("image: app:1\n");
});

test("renders every level of a deep error chain", () => {
	let error: unknown = { stack: "Error: root\n    at root" };
	for (let index = 0; index < 24; index++) error = { message: `wrapper ${index}`, cause: error };
	const { stack } = presentDiagnostics(JSON.stringify({ error }));
	expect(stack).toContain("Error: root\n    at root");
	expect(stack).not.toContain("[truncated]");
});

test("retains both cause and error when a provider supplies both", () => {
	const { stack } = presentDiagnostics(
		JSON.stringify({
			error: {
				message: "failed",
				cause: { stack: "Error: first\n    at first" },
				error: { stack: "Error: second\n    at second" },
			},
		}),
	);
	expect(stack).toContain("Caused by:\nError: first\n    at first");
	expect(stack).toContain("Caused by:\nError: second\n    at second");
	expect(stack).not.toContain("\\n");
});

test("marks excessive error chains explicitly", () => {
	let error: unknown = { message: "root" };
	for (let index = 0; index < 150; index++) error = { error };
	expect(presentDiagnostics(JSON.stringify({ error })).stack).toContain("[truncated]");
});
