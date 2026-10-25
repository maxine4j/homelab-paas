import { z } from "zod";

import type { IPaasConfig } from "../../../config/paas-config.ts";
import type { DnsChallengeRecord } from "./types.ts";
export interface IDnsAcmeChallengeProvider {
	/** Creates only the challenge TXT record; failures retain their underlying cause. */
	createChallenge(identifier: string, value: string): Promise<DnsChallengeRecord>;
	/** Removes only the record returned by createChallenge. */
	removeChallenge(record: DnsChallengeRecord): Promise<void>;
}
export class DigitalOceanDnsAcmeChallengeProvider implements IDnsAcmeChallengeProvider {
	constructor(
		private readonly config: IPaasConfig,
		private readonly request: typeof fetch,
		private readonly apiEndpoint = "https://api.digitalocean.com/v2",
	) {}
	async createChallenge(identifier: string, value: string): Promise<DnsChallengeRecord> {
		try {
			const { baseDomain } = this.config.getIngressConfig();
			const domain = identifier.replace(/^\*\./, "");
			if (
				domain !== baseDomain
				&& !Object.keys(this.config.getServices()).some((id) => domain === `${id}.${baseDomain}`)
			)
				throw new Error();
			const labels = domain.split(".");
			let zone: string | undefined;
			while (labels.length >= 2) {
				const candidate = labels.join(".");
				const response = await this.send(`/domains/${candidate}`, "GET");
				if (response.status === 404) {
					labels.shift();
					continue;
				}
				if (!response.ok)
					throw new Error(
						`DigitalOcean zone lookup failed: HTTP ${response.status}: ${await response.text()}`,
					);
				if (
					z.object({ domain: z.object({ name: z.string() }) }).parse(await response.json()).domain.name
					!== candidate
				)
					throw new Error(`DigitalOcean returned a different zone for ${candidate}`);
				zone = candidate;
				break;
			}
			if (!zone) throw new Error(`No DigitalOcean DNS zone found for ${baseDomain}`);
			const prefix = domain === zone ? "" : `.${domain.slice(0, -(zone.length + 1))}`;
			const response = await this.send(`/domains/${zone}/records`, "POST", {
				type: "TXT",
				name: `_acme-challenge${prefix}`,
				data: value,
				ttl: 300,
			});
			if (!response.ok)
				throw new Error(`DigitalOcean TXT creation failed: HTTP ${response.status}: ${await response.text()}`);
			const payload = z
				.object({ domain_record: z.object({ id: z.number().int().positive() }) })
				.parse(await response.json());
			return { zone, id: payload.domain_record.id };
		} catch (cause) {
			throw new Error("DNS challenge failed", { cause });
		}
	}
	async removeChallenge(record: DnsChallengeRecord): Promise<void> {
		try {
			const response = await this.send(`/domains/${record.zone}/records/${record.id}`, "DELETE");
			if (!response.ok && response.status !== 404)
				throw new Error(`DigitalOcean TXT removal failed: HTTP ${response.status}: ${await response.text()}`);
		} catch (cause) {
			throw new Error("DNS challenge failed", { cause });
		}
	}
	private send(path: string, method: string, body?: Record<string, string | number>): Promise<Response> {
		return this.request(`${this.apiEndpoint}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.config.getTlsConfig()!.dns.credentials.apiToken}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10_000),
		});
	}
}
