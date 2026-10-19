import { z, ZodError } from "zod";

import { ValidationError } from "./error.ts";

export const validate = <TType>(data: unknown, schema: z.ZodType<TType>): TType => {
	try {
		return schema.parse(data);
	} catch (error) {
		if (error instanceof ZodError) {
			throw new ValidationError(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
		}
		throw error;
	}
};
