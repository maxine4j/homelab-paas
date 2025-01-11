import pino, { Logger } from 'pino';

let pinoInstance: Logger | undefined;

if (!pinoInstance) {
  pinoInstance = pino();
}

export const logger: Logger = pinoInstance;
