import { z } from "zod";

import type { DnsAcmeChallengeProvider, StatefulDnsChallenge } from "./types.ts";
import { DnsChallengeError } from "./types.ts";

export interface DigitalOceanDnsConfig {
	domain: string;
	accessToken: string;
}
const recordSchema = z.object({
	domain_record: z.object({ id: z.number().int().positive().safe() }),
});

export class DigitalOceanDnsAcmeChallengeProvider implements DnsAcmeChallengeProvider {
	private readonly config: DigitalOceanDnsConfig;
	private readonly request: typeof fetch;
	constructor(config: DigitalOceanDnsConfig, request: typeof fetch) {
		this.config = config;
		this.request = request;
	}

	createStatefulChallenge(): StatefulDnsChallenge {
		const records = new Map<string, number>();
		const pending = new Set<string>();
		return {
			createChallenge: async (id, domain, value, signal) => {
				const suffix = `.${this.config.domain}`;
				if (domain !== this.config.domain && !domain.endsWith(suffix))
					throw new DnsChallengeError("Challenge outside configured DNS zone");
				if (pending.has(id) || records.has(id)) throw new DnsChallengeError("Challenge already exists");
				pending.add(id);
				try {
					const prefix = domain === this.config.domain ? "" : `.${domain.slice(0, -suffix.length)}`;
					const response = await this.send(
						"",
						{
							method: "POST",
							body: JSON.stringify({
								type: "TXT",
								name: `_acme-challenge${prefix}`,
								data: value,
								ttl: 300,
							}),
						},
						signal,
					);
					records.set(id, recordSchema.parse(await response.json()).domain_record.id);
				} catch {
					throw new DnsChallengeError("DNS challenge request failed");
				} finally {
					pending.delete(id);
				}
			},
			removeChallenge: async (id, signal) => {
				const record = records.get(id);
				if (record === undefined) return;
				try {
					await this.send(`/${record}`, { method: "DELETE" }, signal);
					records.delete(id);
				} catch {
					throw new DnsChallengeError("DNS challenge request failed");
				}
			},
		};
	}

	private async send(path: string, options: RequestInit, signal?: AbortSignal): Promise<Response> {
		const timeout = AbortSignal.timeout(30_000);
		const response = await this.request(
			`https://api.digitalocean.com/v2/domains/${encodeURIComponent(this.config.domain)}/records${path}`,
			{
				...options,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.config.accessToken}`,
				},
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			},
		);
		if (!response.ok && !(options.method === "DELETE" && response.status === 404))
			throw new DnsChallengeError("DNS challenge request failed");
		return response;
	}
}
