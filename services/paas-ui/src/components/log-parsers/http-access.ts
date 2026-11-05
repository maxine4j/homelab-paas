const method = "[A-Z][A-Z0-9-]*";
const path = String.raw`(?:/[^\s"]*|\*|https?://[^\s"]+)`;
const request = "(?<method>" + method + ") (?<path>" + path + ")";
const status = "(?<status>[1-5][0-9]{2})";
const duration = String.raw`\d+(?:\.\d+)?`;
const bytes = String.raw`(?:\d+|-)`;
const version = String.raw`HTTP/(?<httpVersion>\d+(?:\.\d+)?)`;
const peer = String.raw`(?<remoteAddress>\S+) (?<remoteUser>\S+)`;

const arrow = new RegExp(
	String.raw`^(?:-->|-x-) ${request} ${status} (?<duration>${duration}(?:ms|s|m|h)) (?<size>${duration}[a-zA-Z]+|-)$`,
);
const dev = new RegExp(String.raw`^${request} ${status} (?<durationMs>${duration}) ms - (?<bytes>${bytes})$`);
const timedResponse = String.raw`${status} (?<bytes>${bytes}) - (?<durationMs>${duration}) ms$`;
const tiny = new RegExp("^" + request + " " + timedResponse);
const short = new RegExp("^" + peer + " " + request + " " + version + " " + timedResponse);
const common = new RegExp(
	String.raw`^(?<remoteAddress>\S+) - (?<remoteUser>\S+) \[(?<accessTime>[^\]]+)\] "${request} ${version}" ${status} (?<bytes>${bytes})(?: "(?<referrer>[^"]*)" "(?<userAgent>[^"]*)")?$`,
);

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const commonTimestamp =
	/^(?<day>\d{2})\/(?<month>[A-Z][a-z]{2})\/(?<year>\d{4}):(?<clock>\d{2}:\d{2}:\d{2}) (?<hour>[+-]\d{2})(?<minute>\d{2})$/;

const isoAccessTime = (value: string | undefined): string | undefined => {
	const parts = commonTimestamp.exec(value ?? "")?.groups;
	if (!parts) return undefined;
	const month = months.indexOf(parts["month"] ?? "") + 1;
	if (!month) return undefined;
	const date = [parts["year"], String(month).padStart(2, "0"), parts["day"]].join("-");
	return date + "T" + parts["clock"] + parts["hour"] + ":" + parts["minute"];
};

export const parseHttpAccessLog = (line: string): Record<string, unknown> | undefined => {
	// oxlint-disable-next-line no-control-regex -- Strip ANSI SGR color sequences emitted by access loggers.
	const input = line.replaceAll(/\x1b\[[0-9;]*m/g, "").trim();
	const fields = (arrow.exec(input) ?? dev.exec(input) ?? tiny.exec(input) ?? short.exec(input) ?? common.exec(input))
		?.groups;
	if (!fields) return undefined;
	const { status, accessTime, ...context } = fields;
	return {
		...context,
		status: Number(status),
		...(accessTime ? { accessTime, time: isoAccessTime(accessTime) } : {}),
	};
};

export const summarizeHttpAccess = (data: Record<string, unknown>): string | undefined => {
	const { method, path, status } = data;
	if (typeof method !== "string" || typeof path !== "string" || typeof status !== "number") return undefined;
	if (!/^[A-Z][A-Z0-9-]*$/.test(method) || !path || !Number.isInteger(status) || status < 100 || status > 599)
		return undefined;
	return method + " " + path + " → " + status;
};
