import fastify from "fastify";

/** Final-boundary logging; callers provide safe messages and context rather than raw exceptions. */
export function createProcessLogger() {
  return fastify({ logger: true }).log;
}
