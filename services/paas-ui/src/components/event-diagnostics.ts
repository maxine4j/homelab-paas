const record = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const errorText = (value: unknown, depth = 0): string => {
	if (depth > 12) return "[truncated]";
	if (Array.isArray(value)) return value.map((entry) => errorText(entry, depth + 1)).join("\n\n");
	if (!record(value)) return typeof value === "string" ? value : (JSON.stringify(value, undefined, 2) ?? "");
	const { stack, name, message, cause, errors, ...provider } = value;
	return [
		typeof stack === "string" ? stack : [name, message].filter((part) => typeof part === "string").join(": "),
		cause !== undefined ? `Caused by:\n${errorText(cause, depth + 1)}` : "",
		errors !== undefined ? `Related errors:\n${errorText(errors, depth + 1)}` : "",
		Object.keys(provider).length ? `Provider details:\n${JSON.stringify(provider, undefined, 2)}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
};

const stripPaths = (text: string): string => text.replaceAll("file:///app/services/paas/", "");

/** Legacy plain or clipped JSON remains selectable when structured fields cannot be decoded. */
export const presentDiagnostics = (text: string): { message?: string; stack: string; context?: string } => {
	try {
		const diagnostic: unknown = JSON.parse(text);
		if (!record(diagnostic) || !("error" in diagnostic)) return { stack: stripPaths(errorText(diagnostic)) };
		const message =
			record(diagnostic["error"]) && typeof diagnostic["error"]["message"] === "string"
				? diagnostic["error"]["message"].replace(/\s+/g, " ").trim()
				: undefined;
		return {
			message: message ? (message.length <= 4096 ? message : `${message.slice(0, 4084)} [truncated]`) : undefined,
			stack: stripPaths(errorText(diagnostic["error"])),
			context:
				typeof diagnostic["contextYaml"] === "string"
					? diagnostic["contextYaml"]
					: diagnostic["context"] !== undefined
						? JSON.stringify(diagnostic["context"], undefined, 2)
						: undefined,
		};
	} catch {
		return { stack: stripPaths(text) };
	}
};
