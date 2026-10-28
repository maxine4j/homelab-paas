import { redactSecrets } from "./secret-redaction.ts";

export interface ILogRedactor {
	/** Returns only confirmed safe text. Incomplete secrets/tokens are retained until resolved. */
	push(chunk: string, final?: boolean): string;
}

export class LogRedactor implements ILogRedactor {
	private pending = "";
	private readonly secrets: string[];
	constructor(secrets: string[]) {
		this.secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
	}
	push(chunk: string, final = false): string {
		this.pending += chunk;
		if (this.pending.length > 262144) throw new Error("Log output exceeds pending limit");
		let end = this.pending.length;
		for (const secret of this.secrets) {
			for (let length = Math.min(secret.length - 1, this.pending.length); length > 0; length--) {
				if (this.pending.endsWith(secret.slice(0, length))) {
					end = Math.min(end, this.pending.length - length);
					break;
				}
			}
		}
		const url = /https?:\/\/\S*$/i.exec(this.pending);
		if (url) end = Math.min(end, url.index);
		for (const scheme of ["http://", "https://"]) {
			for (let length = scheme.length - 1; length > 0; length--) {
				if (this.pending.toLowerCase().endsWith(scheme.slice(0, length)))
					end = Math.min(end, this.pending.length - length);
			}
		}
		let previous: number;
		do {
			previous = end;
			for (const secret of this.secrets) {
				let index = this.pending.indexOf(secret);
				while (index !== -1 && index < end) {
					if (index + secret.length > end) end = index;
					index = this.pending.indexOf(secret, index + 1);
				}
			}
			for (const token of this.pending.matchAll(/https?:\/\/\S+/gi)) {
				if (token.index < end && token.index + token[0].length > end) end = token.index;
			}
		} while (end !== previous);
		let content = redactSecrets(this.pending.slice(0, end), this.secrets);
		this.pending = this.pending.slice(end);
		if (final && this.pending) {
			content += "[redacted]";
			this.pending = "";
		}
		return content;
	}
}
