import Koa from "koa";
import { expect, test } from "vitest";

import { createLogger, createRequestLogger, withLogContext } from "./logger.ts";
import { sleep } from "./sleep.ts";
import { startTestApi } from "./test/router.ts";

test("error fields and commands retain original details and nested cause stacks", () => {
	const lines: string[] = [];
	const log = createLogger("test", { write: (line: string) => lines.push(line) });
	const cause = Object.assign(new Error("original details"), { code: "EACCES" });
	const error = new Error("Operation failed", { cause: new Error("Adapter failed", { cause }) });
	log.error({ error, err: error, command: "echo SECRET" }, "Operation failed");
	const record = JSON.parse(lines.at(0)!);
	expect(record).toMatchObject({ msg: "Operation failed", level: 50, command: "echo SECRET" });
	for (const field of ["error", "err"]) {
		expect(record[field].stack).toContain("Operation failed");
		expect(record[field].stack).toContain("caused by: Error: Adapter failed");
		expect(record[field].stack).toContain("caused by: Error: original details");
		expect(record[field].cause.cause.code).toBe("EACCES");
	}
});

test("JSON lines include timestamps, component and isolated async context, including children", async () => {
	const lines: string[] = [];
	const log = createLogger("Example", { write: (line: string) => lines.push(line) });
	const child = log.child({ resourceId: "web" });
	await Promise.all(
		["one", "two"].map((taskId) =>
			withLogContext({ task: "reconcile", taskId }, async () => {
				await sleep(1);
				child.info("Detected drift; deploying replacement");
			}),
		),
	);
	log.info("Outside task");
	const records = lines.map((line) => JSON.parse(line));
	expect(records.slice(0, 2)).toEqual(
		["one", "two"].map((taskId) =>
			expect.objectContaining({ taskId, task: "reconcile", component: "Example", resourceId: "web" }),
		),
	);
	expect(records.at(2)).not.toHaveProperty("taskId");
	for (const record of records) expect(new Date(record.time).toISOString()).toBe(record.time);
	expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
});

test("request logs include failures and quiet successful health checks", async () => {
	const lines: string[] = [];
	const log = createLogger("http", { write: (line: string) => lines.push(line) });
	const app = new Koa().use(createRequestLogger(log)).use((ctx) => {
		if (ctx.path === "/fail") throw new Error("SECRET");
		if (ctx.path === "/denied") ctx.throw(401);
		ctx.set("set-cookie", "SECRET");
		ctx.body = "ok";
	});
	app.silent = true;
	const api = await startTestApi(app);
	try {
		await fetch(`${api.origin}/health`);
		await fetch(`${api.origin}/auth/callback?code=SECRET`, {
			headers: { authorization: "Bearer SECRET", cookie: "SECRET" },
		});
		await fetch(`${api.origin}/fail`);
		await fetch(`${api.origin}/denied`);
	} finally {
		await api.close();
	}
	expect(lines).toHaveLength(3);
	expect(JSON.parse(lines.at(0)!)).toMatchObject({
		method: "GET",
		path: "/auth/callback",
		status: 200,
		durationMs: expect.any(Number),
	});
	expect(JSON.parse(lines.at(1)!)).toMatchObject({ status: 500, level: 50, err: { message: "SECRET" } });
	expect(JSON.parse(lines.at(2)!)).toMatchObject({ status: 401, level: 40 });
});
