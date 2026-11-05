import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as files from "@homelab-paas/backend-infrastructure/file";
import { expect, test } from "vitest";

import { AccessService } from "../../src/auth/access-service.ts";
import { HttpApplication } from "../../src/http/http-application.ts";
import { ProjectRouter } from "../../src/projects/project-router.ts";
import { GitTransport } from "../../src/repositories/git-transport.ts";
import { RepositoryBrowserClient } from "../../src/repositories/repository-browser-client.ts";
import { RepositoryBrowserRouter } from "../../src/repositories/repository-browser-router.ts";
import { RepositoryBrowserService } from "../../src/repositories/repository-browser-service.ts";
import { RepositoryClient } from "../../src/repositories/repository-client.ts";
import { RepositoryCommitClient } from "../../src/repositories/repository-commit-client.ts";

test("commit API reads immutable objects without branches and maps invalid/missing/noncommit/access/unavailable safely", async () => {
	const root = await files.mkdtemp(join(tmpdir(), "forge-commit-api-"));
	const git = new GitTransport();
	const id = "123e4567-e89b-42d3-a456-426614174000";
	const repositories = new RepositoryClient(root, [], files, git);
	const project = { id, name: "Test", status: "ready" as const, createdAt: "2026-11-02T00:00:00.000Z" };
	const projects = {
		get: async () => project,
		list: async () => [project],
		create: async () => project,
		retry: async () => project,
		recover: async () => {},
	};
	const access = new AccessService({ owner: "owner", origin: "https://forge.example" });
	const client = new RepositoryCommitClient(root, git, repositories);
	const service = new RepositoryBrowserService(
		new RepositoryBrowserClient(root, git, repositories),
		projects,
		access,
		client,
	);
	const server = createServer(
		new HttpApplication(new ProjectRouter(projects), access)
			.create([new RepositoryBrowserRouter(service)])
			.callback(),
	);
	try {
		await repositories.prepare(id);
		const args = ["-C", join(root, "repositories", `${id}.git`)];
		const tree = (await git.run([...args, "mktree"], "")).trim();
		const sha = (
			await git.run([
				...args,
				"-c",
				"user.name=Owner",
				"-c",
				"user.email=owner@example.test",
				"commit-tree",
				tree,
				"-m",
				"Root",
			])
		).trim();
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing listener");
		const read = (value: string, owner = "owner") =>
			fetch(`http://127.0.0.1:${address.port}/api/projects/${id}/repository/commits/${value}`, {
				headers: { "x-webauth-user": owner },
			});
		const result = await read(sha);
		expect(result.status).toBe(200);
		expect(await result.json()).toMatchObject({
			sha,
			subject: "Root",
			files: [],
			parents: [],
			totalsComplete: true,
		});
		for (const [value, status, error] of [
			["main", 400, "invalid-request"],
			["f".repeat(40), 404, "commit-not-found"],
			[tree, 404, "commit-not-found"],
		] as const) {
			const response = await read(value);
			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({ error });
		}
		expect((await read(sha, "intruder")).status).toBe(403);
		await git.close();
		const failed = await read(sha);
		expect(failed.status).toBe(503);
		expect(await failed.json()).toEqual({ error: "workspace-unavailable" });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
		await git.close();
		await files.rm(root, { recursive: true, force: true });
	}
});
