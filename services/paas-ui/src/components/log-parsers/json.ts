export const isLogRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const parseJsonLog = (line: string): Record<string, unknown> | undefined => {
	if (!line.trimStart().startsWith("{")) return undefined;
	try {
		const data: unknown = JSON.parse(line);
		return isLogRecord(data) ? data : undefined;
	} catch {
		return undefined;
	}
};
