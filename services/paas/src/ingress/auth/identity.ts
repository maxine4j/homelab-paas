import { z } from "zod";

const headerValue = z
	.string()
	.min(1)
	.max(256)
	// eslint-disable-next-line no-control-regex -- Identity values become HTTP headers.
	.regex(/^[^\x00-\x1f\x7f]+$/);

export const authenticatedUserSchema = z.object({
	userId: headerValue.regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/),
	email: headerValue.email().optional(),
	name: headerValue.optional(),
});
