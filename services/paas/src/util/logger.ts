import { Middleware } from 'koa';
import koaPino from 'koa-pino-logger';
import pino, { Logger } from 'pino';

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
