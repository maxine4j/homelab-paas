import { z, ZodError } from 'zod';
import { ValidationError } from './error';

export const validate = <TType>(
  data: unknown,
  schema: z.Schema<TType>,
): TType => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(
        error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      );
    }
    throw error;
  }
};
