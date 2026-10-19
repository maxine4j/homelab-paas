import { Middleware } from 'koa';
import { logger } from './logger';

export class ValidationError extends Error {
  constructor(public errors: Array<string>) {
    super('ValidationError');
  }
}

export class ContextualError extends Error {
  name = 'ContextualError';
  constructor(
    message: string,
    public context: Record<string, unknown> = {},
    cause?: Error | unknown,
  ) {
    super(message, { cause });
  }
}

export class DomainError extends ContextualError {
  name = 'DomainErrors';
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: Error | unknown,
  ) {
    super(message, context, { cause });
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
      };
      logger.error({ error }, 'Validation Error');
      return;
    }

    if (error instanceof DomainError) {
      ctx.status = 400;
      ctx.body = {
        message: error.message,
      };
      logger.error({ error }, 'Domain Error');
      return;
    }

    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error',
    };
    logger.error({ error }, 'Internal Server Error');
  }
};
