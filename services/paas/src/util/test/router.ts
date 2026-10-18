import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import type Koa from "koa";

/** Exercise Koa through real HTTP, preserving raw paths for traversal checks. */
export async function startTestApi<State, Context>(app: Koa<State, Context>) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  const port = address.port;
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    inject: (input: string | { method: string; url: string }) =>
      new Promise<{
        statusCode: number;
        headers: IncomingHttpHeaders;
        body: string;
        json: () => unknown;
      }>((resolve, reject) => {
        const options = typeof input === "string" ? { method: "GET", url: input } : input;
        const req = request(
          { hostname: "127.0.0.1", port, method: options.method, path: options.url },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => {
              const body = Buffer.concat(chunks).toString();
              resolve({
                statusCode: response.statusCode ?? 0,
                headers: response.headers,
                body,
                json: (): unknown => JSON.parse(body),
              });
            });
          },
        );
        req.on("error", reject);
        req.end();
      }),
  };
}
