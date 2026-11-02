import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as files from "@homelab-paas/backend-infrastructure/file";
import { createLogger } from "@homelab-paas/backend-infrastructure/logger";
import { sleep } from "@homelab-paas/backend-infrastructure/sleep";

import { AccountAttemptStore } from "./accounts/account-attempt-store.ts";
import { AccountProcess } from "./accounts/account-process.ts";
import { AccountRouter } from "./accounts/account-router.ts";
import { AccountService } from "./accounts/account-service.ts";
import { CodexAccountClient } from "./accounts/codex-account-client.ts";
import { CodexConnection } from "./accounts/codex-connection.ts";
import { GithubAccountClient } from "./accounts/github-account-client.ts";
import { AccessService } from "./auth/access-service.ts";
import { Configuration } from "./config/configuration.ts";
import { SqliteDatabase } from "./database/sqlite-database.ts";
import { HttpApplication } from "./http/http-application.ts";
import type { ILifecycle } from "./http/lifecycle.ts";
import { StaticAssets } from "./http/static-assets.ts";
import { ProjectRouter } from "./projects/project-router.ts";
import { ProjectService } from "./projects/project-service.ts";
import { ProjectStore } from "./projects/project-store.ts";
import { GitTransport } from "./repositories/git-transport.ts";
import { RepositoryClient } from "./repositories/repository-client.ts";
import type { StartOptions } from "./types.ts";

export const start = async (lifecycle: ILifecycle, options: StartOptions = {}): Promise<void> => {
	process.umask(0o077);
	const log = createLogger("Forge");
	const config = new Configuration(process.env).load();
	await files.mkdir(config.dataDirectory, { recursive: true, mode: 0o700 });
	if (!(await files.lstat(config.dataDirectory)).isDirectory())
		throw new Error("Forge data root must be a directory");
	await files.chmod(config.dataDirectory, 0o700);
	if (!lifecycle.isOpen()) return;
	const database = new SqliteDatabase(join(config.dataDirectory, "forge.sqlite"));
	lifecycle.register(() => database.close());
	await database.initialize();
	if (!lifecycle.isOpen()) return;
	const store = new ProjectStore(database);
	await store.initialize();
	if (!lifecycle.isOpen()) return;
	const access = new AccessService(config);
	const git = options.git ?? new GitTransport(sleep);
	const repositories = new RepositoryClient(config.dataDirectory, config.importHosts, files, git);
	const projects = new ProjectService(store, repositories, access, randomUUID, () => new Date());
	let recovery = Promise.resolve();
	lifecycle.register(async () => {
		await git.close();
		await recovery.catch(() => {});
	});
	recovery = projects.recover();
	await recovery;
	if (!lifecycle.isOpen()) return;
	const attempts = new AccountAttemptStore(database);
	await attempts.initialize();
	if (!lifecycle.isOpen()) return;
	const processes = new AccountProcess(
		{
			dataDirectory: config.dataDirectory,
			path: process.env["PATH"] ?? "",
			codexExecutable: fileURLToPath(new URL("../node_modules/.bin/codex", import.meta.url)),
			githubExecutable: "gh",
		},
		sleep,
	);
	// Credential-home failure is reported by account APIs, without withholding project HTTP or health.
	try {
		await processes.initialize();
	} catch (err) {
		log.warn({ err }, "Account credential homes unavailable");
	}
	if (!lifecycle.isOpen()) return;
	const connection = new CodexConnection(processes, sleep);
	lifecycle.register(() => connection.close());
	const codex = new CodexAccountClient(connection, attempts);
	const github = new GithubAccountClient(processes, sleep, attempts);
	lifecycle.register(() => github.close());
	const accounts = new AccountService(access, codex, github);
	const assets = new StaticAssets(fileURLToPath(new URL("../packages/frontend/dist", import.meta.url)), files);
	if (!(await assets.read("/"))) throw new Error("Build Forge frontend before starting the application");
	if (!lifecycle.isOpen()) return;
	const app = new HttpApplication(new ProjectRouter(projects), access).create([new AccountRouter(accounts)], assets);
	app.on("error", (err) => log.error({ err }, "HTTP request failed"));
	const server = createServer(app.callback());
	let listening: Promise<void> = Promise.resolve();
	lifecycle.register(() =>
		listening
			.catch(() => {})
			.then(() =>
				(async () => {
					if (!server.listening) {
						return;
					}
					const drained = new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					);
					server.closeIdleConnections();
					await git.close();
					await drained;
				})(),
			),
	);
	listening = new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			reject(error);
		};
		server.once("error", onError);
		server.listen(config.port, "0.0.0.0", () => {
			server.off("error", onError);
			resolve();
		});
	});
	await listening;
	if (!lifecycle.isOpen()) return;
	server.on("error", (error) => {
		throw error;
	});
	log.info({ port: config.port }, "Forge listening");
	void connection
		.initialize()
		.catch((err: unknown) => log.warn({ err }, "Codex unavailable; project HTTP remains available"));
};
