const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const timestamp = (value: unknown): Date | undefined => {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : undefined;
};

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
	if (level === "fatal") return "error";
	if (level === "trace") return "debug";
	return ["info", "warn", "error", "debug"].includes(level) ? level : "unknown";
};

const stacks = (value: unknown, path = "", budget = { nodes: 256 }): string[] => {
	if (budget.nodes-- <= 0) return ["[Diagnostic traversal truncated]"];
	const isCause = /(?:^|\.)cause(?:\[\d+\])*$/.test(path);
	if (isCause && !isRecord(value) && !Array.isArray(value))
		return [typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))];
	if (typeof value === "string")
		return /(?:^|\n)\s*at .+|(?:^|\n)(?:Caused by|caused by):/.test(value) || /(?:^|\.)stack$/i.test(path)
			? [`${path}\n${value}`]
			: [];
	if (Array.isArray(value)) return value.flatMap((entry, index) => stacks(entry, `${path}[${index}]`, budget));
	if (!isRecord(value)) return [];
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
	const prefix = /^(\d{4}-\d{2}-\d{2}T\S+)\s+/.exec(raw);
	try {
		const data: unknown = JSON.parse(prefix ? raw.slice(prefix[0].length) : raw);
		if (!isRecord(data)) return undefined;
		const messageKey = ["message", "msg"].find((key) => typeof data[key] === "string");
		const error = [data["error"], data["err"], data["failure"]].find(isRecord);
		const message = messageKey
			? String(data[messageKey])
			: typeof error?.["message"] === "string"
				? error["message"]
				: "Structured log";
		const timeKey = ["time", "timestamp"].find((key) => timestamp(data[key]));
		return {
			raw,
			data,
			message,
			level: severity(data["level"] ?? data["severity"]),
			time: timestamp(timeKey ? data[timeKey] : prefix?.[1]),
			context: Object.fromEntries(
				Object.entries(data).filter(
					([key]) => key !== messageKey && key !== timeKey && key !== "level" && key !== "severity",
				),
			),
			stack: stacks(data).join("\n\n"),
		};
	} catch {
		return undefined;
	}
};
