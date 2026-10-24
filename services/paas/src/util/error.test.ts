import Koa from "koa";
import { expect, test } from "vitest";
import { z } from "zod";

import { DomainError, ValidationError, errorMiddleware } from "./error.ts";
import { captureLogs } from "./test/logs.ts";
import { startTestApi } from "./test/router.ts";
import { validate } from "./validation.ts";

test.each([new Error("internal failure"), new DomainError("domain failure"), new ValidationError(["invalid field"])])(
	"middleware logs original %s details without changing response contracts",
	async (error) => {
		const api = await startTestApi(
			new Koa().use(errorMiddleware).use(() => {
				throw error;
			}),
		);
		const capture = captureLogs();
		try {
			const response = await fetch(api.origin);
			expect(response.status).toBe(error instanceof DomainError || error instanceof ValidationError ? 400 : 500);
			await response.body?.cancel();
		} finally {
			await api.close();
			capture.restore();
		}
		expect(JSON.parse(capture.lines.at(0)!).err.message).toBe(error.message);
	},
);

test("validation retains schema errors as its cause", () => {
	try {
		validate("invalid", z.number());
		throw new Error("Expected rejection");
	} catch (error) {
		expect(error).toMatchObject({ cause: expect.any(z.ZodError) });
	}
});
