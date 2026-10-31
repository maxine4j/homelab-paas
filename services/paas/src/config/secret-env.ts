export class SecretFileSyntaxError extends Error {
	constructor(readonly line: number) {
		super(`Invalid secret assignment at line ${line}`);
	}
}

/** Canonical literal single-line dotenv format, shared by deployment and editing. */
export const parseSecretEnv = (content: string): Map<string, string> => {
	if (content.includes("\0")) throw new Error("Invalid secret file");
	const values = new Map<string, string>();
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		if (/^\s*(?:#.*)?$/.test(line)) continue;
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^'"#]*?))\s*(?:#.*)?$/.exec(line);
		const name = match?.at(1);
		if (!name || values.has(name)) throw new SecretFileSyntaxError(index + 1);
		values.set(name, match?.at(2) ?? match?.at(3) ?? match?.at(4)?.trim() ?? "");
	}
	return values;
};
export const serializeSecretEnv = (values: Map<string, string>): string => {
	return [...values]
		.map(([name, value]) => {
			if (
				!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
				|| /[\r\n\0]/.test(value)
				|| (value.includes("'") && value.includes('"'))
			)
				throw new Error(
					"Secrets require valid names and single-line values without NUL or both quote characters",
				);
			const quote = value.includes("'") ? '"' : "'";
			return `${name}=${quote}${value}${quote}\n`;
		})
		.join("");
};
