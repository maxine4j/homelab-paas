import { ticketWorkflowSchema, type TicketWorkflow, type MoveTicket } from "@homelab-paas/forge-contracts/tickets";
import { z } from "zod";

import type { IDatabase } from "../database/sqlite-database.ts";
import { TicketError } from "./errors.ts";

export interface ITicketWorkflowStore {
	get(id: string): Promise<TicketWorkflow | undefined>;
	list(): Promise<TicketWorkflow[]>;
	/** Persists job intent and any board move in one transaction. */
	save(record: TicketWorkflow, move?: MoveTicket): Promise<void>;
}
export class TicketWorkflowStore implements ITicketWorkflowStore {
	constructor(private readonly database: IDatabase) {}
	async initialize(): Promise<void> {
		await this.database.run(
			"CREATE TABLE IF NOT EXISTS ticket_workflows (ticketId TEXT PRIMARY KEY REFERENCES tickets(id), record TEXT NOT NULL)",
		);
	}
	async get(id: string): Promise<TicketWorkflow | undefined> {
		const records = await this.read("SELECT record FROM ticket_workflows WHERE ticketId=?", [id]);
		return records.at(0);
	}
	async list(): Promise<TicketWorkflow[]> {
		return this.read("SELECT record FROM ticket_workflows ORDER BY rowid", []);
	}
	async save(record: TicketWorkflow, move?: MoveTicket): Promise<void> {
		try {
			const value = ticketWorkflowSchema.parse(record);
			await this.database.transaction([
				{
					sql: "INSERT INTO ticket_workflows(ticketId,record) VALUES(?,?) ON CONFLICT(ticketId) DO UPDATE SET record=excluded.record",
					parameters: [value.ticketId, JSON.stringify(value)],
				},
				...(move
					? [
							{
								sql: "UPDATE tickets SET position=position+1 WHERE projectId=(SELECT projectId FROM tickets WHERE id=?) AND status=? AND position >= (SELECT position FROM tickets WHERE id=?)",
								parameters: [value.ticketId, move.status, move.beforeId ?? null],
							},
							{
								sql: "UPDATE tickets SET status=?,position=COALESCE((SELECT position-1 FROM tickets WHERE id=?),(SELECT COALESCE(MAX(position),0)+1 FROM tickets WHERE projectId=(SELECT projectId FROM tickets WHERE id=?) AND status=?)) WHERE id=?",
								parameters: [
									move.status,
									move.beforeId ?? null,
									value.ticketId,
									move.status,
									value.ticketId,
								],
							},
						]
					: []),
			]);
		} catch (cause) {
			throw new TicketError("ticket-unavailable", { cause });
		}
	}
	private async read(sql: string, parameters: string[]): Promise<TicketWorkflow[]> {
		try {
			return (await this.database.all(sql, parameters)).map((row) =>
				ticketWorkflowSchema.parse(JSON.parse(z.object({ record: z.string() }).parse(row).record)),
			);
		} catch (cause) {
			throw new TicketError("ticket-unavailable", { cause });
		}
	}
}
