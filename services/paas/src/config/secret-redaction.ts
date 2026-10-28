/** Pure completed-text masking. Resolve all original-text ranges before changing syntax or overlapping secrets. */
export const redactSecrets = (value: string, secrets: readonly string[]): string => {
	const ranges: { start: number; end: number }[] = [];
	for (const secret of secrets.filter(Boolean)) {
		let start = value.indexOf(secret);
		while (start !== -1) {
			ranges.push({ start, end: start + secret.length });
			start = value.indexOf(secret, start + 1);
		}
	}
	for (const match of value.matchAll(/(https?:\/\/)([^\s/?#]+)@/gi)) {
		const start = match.index + match[1]!.length;
		ranges.push({ start, end: start + match[2]!.length });
	}
	ranges.sort((a, b) => a.start - b.start || b.end - a.end);
	let output = "";
	let offset = 0;
	for (const range of ranges) {
		if (range.start >= offset) output += value.slice(offset, range.start) + "[redacted]";
		offset = Math.max(offset, range.end);
	}
	return output + value.slice(offset);
};
