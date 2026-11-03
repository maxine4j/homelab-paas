import { z } from "zod";

export const ticketStatuses = [
	"draft",
	"ready",
	"planning",
	"plan-review",
	"working",
	"work-review",
	"merging",
	"done",
] as const;
export const ticketStatusSchema = z.enum(ticketStatuses);
export const ticketIdSchema = z.string().regex(/^FORGE-[1-9]\d{0,14}$/u);
export const createTicketSchema = z.strictObject({
	title: z.string().trim().min(1).max(120),
	description: z.string().max(4000).default(""),
});
export const updateTicketSchema = createTicketSchema;
export const moveTicketSchema = z.strictObject({ status: ticketStatusSchema, beforeId: ticketIdSchema.optional() });
export const ticketSchema = z.strictObject({
	id: ticketIdSchema,
	projectId: z.uuid(),
	title: z.string().min(1).max(120),
	description: z.string().max(4000),
	status: ticketStatusSchema,
	createdAt: z.iso.datetime(),
});
export const ticketsSchema = z.array(ticketSchema).max(1000);
export type { Ticket, TicketStatus, CreateTicket, MoveTicket } from "./types.ts";
