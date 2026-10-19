import { bodyParser } from "@koa/bodyparser";
import Koa from "koa";

import { createHealthCheckRouter } from "./healthcheck.ts";
import { createRequestLogger } from "./logger.ts";
import { createPingRouter } from "./ping.ts";

const port = Number(process.env["PORT"] ?? 8080);

const main = () => {
	const app = new Koa();

	app.use(createRequestLogger())
		.use(createHealthCheckRouter().routes())
		.use(bodyParser())
		.use(createPingRouter().routes())
		.use((ctx) => {
			ctx.body = `
        <html>
          <h1>Hello, test-service</h1>
        </html>
      `;
		});
	app.listen(port, () => {
		console.log(`Listening on ${port}`);
	});
};

main();
