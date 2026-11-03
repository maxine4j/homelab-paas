import {
	createTicketSchema,
	moveTicketSchema,
	ticketSchema,
	ticketsSchema,
} from "@homelab-paas/forge-contracts/tickets";
import Router from "@koa/router";

import type { Actor } from "../auth/types.ts";
import type { IHttpRouter } from "../http/http-application.ts";
import { TicketError } from "./errors.ts";
import type { ITicketService } from "./ticket-service.ts";

export class TicketRouter implements IHttpRouter {
	constructor(private readonly service: ITicketService) {}
	create(): Router<{ actor: Actor }> {
		const router = new Router<{ actor: Actor }>();
		router.get("/api/projects/:projectId/tickets", async (ctx) => {
			ctx.body = ticketsSchema.parse(await this.service.list(ctx.state.actor, ctx.params["projectId"]!));
		});
		router.post("/api/projects/:projectId/tickets", async (ctx) => {
			const input = createTicketSchema.safeParse(ctx.request.body);
			if (!input.success) throw new TicketError("invalid-request");
			ctx.body = ticketSchema.parse(
				await this.service.create(ctx.state.actor, ctx.params["projectId"]!, input.data),
			);
			ctx.status = 201;
		});
		router.get("/api/tickets/:id", async (ctx) => {
			ctx.body = ticketSchema.parse(await this.service.get(ctx.state.actor, ctx.params["id"]!));
		});
		router.patch("/api/tickets/:id", async (ctx) => {
			const input = createTicketSchema.safeParse(ctx.request.body);
			if (!input.success) throw new TicketError("invalid-request");
			ctx.body = ticketSchema.parse(await this.service.update(ctx.state.actor, ctx.params["id"]!, input.data));
		});
		router.post("/api/tickets/:id/move", async (ctx) => {
			const input = moveTicketSchema.safeParse(ctx.request.body);
			if (!input.success) throw new TicketError("invalid-request");
			ctx.body = ticketSchema.parse(await this.service.move(ctx.state.actor, ctx.params["id"]!, input.data));
		});
		return router;
	}
}
