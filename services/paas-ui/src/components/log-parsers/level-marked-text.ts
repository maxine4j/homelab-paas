import { parseTimestamp } from "./timestamp.ts";

const markerLevels = new Map([
	["T", "trace"],
	["D", "debug"],
	["I", "info"],
	["W", "warn"],
	["E", "error"],
	["C", "error"],
	["F", "fatal"],
]);

const sourcePattern =
	/^(?<time>\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (?<source>\S+) \[(?<level>[TDIWECF])\] (?<message>.*)$/;
const componentPattern = /^(?<time>\S+) (?<level>[TDIWECF])! \[(?<component>[^\]]+)\] (?<message>.*)$/;

export const parseLevelMarkedText = (line: string): Record<string, unknown> | undefined => {
	const withSource = sourcePattern.exec(line)?.groups;
	const withComponent = withSource ? undefined : componentPattern.exec(line)?.groups;
	const fields = withSource ?? (parseTimestamp(withComponent?.["time"], true) ? withComponent : undefined);
	if (fields) return { ...fields, level: markerLevels.get(fields["level"] ?? "") };
	if (line.startsWith("panic: ")) return { level: "panic", message: line.slice("panic: ".length) };
	return undefined;
};
