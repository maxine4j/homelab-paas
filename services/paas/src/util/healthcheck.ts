import Router from "@koa/router";
import { type Context } from "koa";

export const createHealthCheckRouter = () => {
	const getHealth = (ctx: Context) => {
		ctx.status = 200;
		ctx.body = {
			status: "up",
		};
	};

	return new Router().get("/health", getHealth);
};

export interface HttpProbe {
	(address: string, port: number, path: string): Promise<boolean>;
}
/** HTTP 2xx is healthy. Redirects, timeouts and connection failures are unhealthy. */
export const probe: HttpProbe = async (address, port, path) => {
	try {
		const host = address.includes(":") ? `[${address}]` : address;
		const response = await fetch(`http://${host}:${port}${path}`, {
			redirect: "manual",
			signal: AbortSignal.timeout(2000),
		});
		await response.body?.cancel();
		return response.status >= 200 && response.status < 300;
	} catch {
		return false;
	}
};
