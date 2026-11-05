import { parseTimestamp } from "./timestamp.ts";

const tabDelimited =
	/^(?<time>[^\t]+)\t(?<level>trace|debug|info|warn(?:ing)?|error|fatal|panic)\t(?<source>[^\t]+)\t(?<message>.*)$/i;

export const parseTabDelimitedLog = (line: string): Record<string, unknown> | undefined => {
	const fields = tabDelimited.exec(line)?.groups;
	return fields && parseTimestamp(fields["time"], true) ? fields : undefined;
};
