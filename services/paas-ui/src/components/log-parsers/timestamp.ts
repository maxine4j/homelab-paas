const zonedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export const parseTimestamp = (value: unknown, requireZone = false): Date | undefined => {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	if (requireZone && (typeof value !== "string" || !zonedTimestamp.test(value))) return undefined;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : undefined;
};

export const splitDockerTimestamp = (line: string): { payload: string; time?: Date } => {
	const separator = line.indexOf(" ");
	const time = separator < 0 ? undefined : parseTimestamp(line.slice(0, separator), true);
	return time ? { payload: line.slice(separator + 1), time } : { payload: line };
};
