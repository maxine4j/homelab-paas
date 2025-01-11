import { Middleware } from "koa";

export class ValidationError extends Error {
  constructor(
    public errors: Array<string>,
  ) {
    super('ValidationError');
  }
}

export class DomainError extends Error {
  constructor(
    message: string,
    public context: Record<string, unknown> = {},
    cause?: Error | unknown,
  ) {
    super(message, { cause });
  }
}

export const errorMiddleware: Middleware = async (ctx, next) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ValidationError) {
      ctx.status = 400;
      ctx.body = {
        message: error.message,
        validationErrors: error.errors,
      }
      return;
    }

    if (error instanceof DomainError) {
      ctx.status = 400;
      ctx.body = {
        message: error.message,
      }
      return;
    }

    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error'
    }
  }
};
