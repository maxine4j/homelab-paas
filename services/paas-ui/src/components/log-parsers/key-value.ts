export const parseKeyValueLog = (line: string): Record<string, unknown> | undefined => {
	const pair = /\s*([\w.-]+)=("(?:[^"\\]|\\.)*"|[^\s"]*)(?=\s|$)/y;
	const input = line.trimEnd();
	const fields = new Map<string, string>();
	while (pair.lastIndex < input.length) {
		const match = pair.exec(input);
		const key = match?.[1];
		const value = match?.[2];
		if (key === undefined || value === undefined) return undefined;
		if (!value.startsWith('"')) {
			fields.set(key, value);
			continue;
		}
		try {
			const decoded: unknown = JSON.parse(value);
			if (typeof decoded !== "string") return undefined;
			fields.set(key, decoded);
		} catch {
			return undefined;
		}
	}
	if (!fields.has("message") && !fields.has("msg") && !fields.has("level") && !fields.has("severity"))
		return undefined;
	return Object.fromEntries(fields);
};
