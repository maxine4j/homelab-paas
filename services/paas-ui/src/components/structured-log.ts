import { parseHttpAccessLog, summarizeHttpAccess } from "./log-parsers/http-access.ts";
import { isLogRecord, parseJsonLog } from "./log-parsers/json.ts";
import { parseKeyValueLog } from "./log-parsers/key-value.ts";
import { parseLevelMarkedText } from "./log-parsers/level-marked-text.ts";
import { parseTabDelimitedLog } from "./log-parsers/tab-delimited.ts";
import { parseTimestamp, splitDockerTimestamp } from "./log-parsers/timestamp.ts";

const severity = (value: unknown): string => {
	if (typeof value === "number") {
		if (value >= 50) return "error";
		if (value >= 40) return "warn";
		if (value >= 30) return "info";
		return "debug";
	}
	if (typeof value !== "string") return "unknown";
	const level = value.toLowerCase();
	if (level === "warning") return "warn";
	if (level === "fatal" || level === "panic") return "error";
	if (level === "trace") return "debug";
	return ["info", "warn", "error", "debug"].includes(level) ? level : "unknown";
};

const stacks = (value: unknown, path = "", budget = { nodes: 256 }): string[] => {
	if (budget.nodes-- <= 0) return ["[Diagnostic traversal truncated]"];
	const isCause = /(?:^|\.)cause(?:\[\d+\])*$/.test(path);
	if (isCause && !isLogRecord(value) && !Array.isArray(value))
		return [typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))];
	if (typeof value === "string")
		return /(?:^|\n)\s*at .+|(?:^|\n)(?:Caused by|caused by):/.test(value) || /(?:^|\.)stack$/i.test(path)
			? [`${path}\n${value}`]
			: [];
	if (Array.isArray(value)) return value.flatMap((entry, index) => stacks(entry, `${path}[${index}]`, budget));
	if (!isLogRecord(value)) return [];
	const parts: string[] = [];
	if (typeof value["stack"] === "string") {
		// Pino may include the same cause in both the stack string and structured cause.
		parts.push(value["cause"] === undefined ? value["stack"] : value["stack"].split(/\ncaused by:/i)[0]!);
	} else if (
		typeof value["message"] === "string"
		&& /(?:^|\.)(?:errors?|err|failure|cause)(?:\[\d+\])*$/.test(path)
	) {
		parts.push(
			`${typeof value["name"] === "string" ? value["name"] : typeof value["type"] === "string" ? value["type"] : "Error"}: ${value["message"]}`,
		);
	}
	for (const [key, entry] of Object.entries(value)) {
		if (key === "stack") continue;
		const nested = stacks(entry, path ? `${path}.${key}` : key, budget);
		if (nested.length)
			parts.push(
				`${key === "cause" ? "Caused by:\n" : key === "errors" ? "Related errors:\n" : ""}${nested.join("\n\n")}`,
			);
	}
	if (!parts.length && isCause) return [JSON.stringify(value, undefined, 2)];
	return parts.length ? [parts.join("\n\n")] : [];
};

export const presentLog = (raw: string) => {
	const { payload, time: dockerTime } = splitDockerTimestamp(raw);
	const json = parseJsonLog(payload);
	const http = json ? undefined : parseHttpAccessLog(payload);
	const parsed =
		json ?? http ?? parseTabDelimitedLog(payload) ?? parseKeyValueLog(payload) ?? parseLevelMarkedText(payload);
	// A bare level-marked line can start with the same timestamp syntax as Docker.
	const data = parsed ?? (dockerTime ? parseLevelMarkedText(raw) : undefined);
	if (!data) return undefined;

	const eventTime = parsed ? dockerTime : undefined;
	const accessSummary = http || json?.["component"] === "ingress" ? summarizeHttpAccess(data) : undefined;
	const messageKey = accessSummary ? undefined : ["message", "msg"].find((key) => typeof data[key] === "string");
	const error = [data["error"], data["err"], data["failure"]].find(isLogRecord);
	const message =
		accessSummary
		?? (messageKey ? String(data[messageKey]) : undefined)
		?? (typeof error?.["message"] === "string" ? error["message"] : "Structured log");
	const timeKey = eventTime
		? undefined
		: (json ? ["time", "timestamp"] : ["time", "timestamp", "t"]).find((key) => parseTimestamp(data[key], !json));

	return {
		raw,
		data,
		message,
		level: severity(data["level"] ?? data["severity"]),
		time: eventTime ?? (timeKey ? parseTimestamp(data[timeKey], !json) : undefined),
		context: Object.fromEntries(
			Object.entries(data).filter(
				([key]) => key !== messageKey && key !== timeKey && key !== "level" && key !== "severity",
			),
		),
		stack: stacks(data).join("\n\n"),
	};
};
