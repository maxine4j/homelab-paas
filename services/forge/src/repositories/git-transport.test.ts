import { expect, test } from "vitest";

import { GitTransport } from "./git-transport.ts";

test("system Git executes without a shell and rejects forbidden protocols with sanitized diagnostics", async () => {
	const git = new GitTransport();
	expect(await git.run(["--version"])).toMatch(/^git version /);
	await expect(git.run(["ls-remote", "file:///SECRET_LOCAL_PATH"])).rejects.toThrow(/^Git operation failed$/);
	await expect(git.run(["ls-remote", "ext::echo SECRET"])).rejects.toThrow(/^Git operation failed$/);
});
