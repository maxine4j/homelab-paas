export interface ILogRedactor {
	/** Best-effort masking of named credential fields; incomplete lines wait for newline or EOF. */
	push(chunk: string, final?: boolean): string;
}

export class LogRedactor implements ILogRedactor {
	private pending = "";

	push(chunk: string, final = false): string {
		this.pending += chunk;
		const end = final ? this.pending.length : this.pending.lastIndexOf("\n") + 1;
		const content = this.mask(this.pending.slice(0, end));
		this.pending = this.pending.slice(end);
		if (this.pending.length > 262144) throw new Error("Log output exceeds pending limit");
		return content;
	}

	private mask(text: string): string {
		// Deliberately match field names, never configured values in arbitrary diagnostic text.
		return text.replace(
			/(^|[\s{,])((?:"|')?(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|signing[_-]?key)(?:"|')?[\t ]*[:=][\t ]*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]*)/gim,
			(_match, boundary: string, field: string, value: string) => {
				const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
				return `${boundary}${field}${quote}[redacted]${quote}`;
			},
		);
	}
}
