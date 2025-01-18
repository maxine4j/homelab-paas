import pino, { Logger } from 'pino';
import koaPino from 'koa-pino-logger';
import { Middleware } from 'koa';

let pinoInstance: Logger | undefined;

if (!pinoInstance) {
  pinoInstance = pino();
}

export const logger: Logger = pinoInstance;

export const createRequestLogger = (): Middleware =>
  koaPino({
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
      ],
    },
  });
