/** Expands tag variables at a fixed commit; rejects invalid syntax, placement or lengths. */
export function resolveImageTag(image: string, revision?: string): string {
	const firstVariable = image.indexOf("${");
	if (firstVariable === -1) return image;
	const prefix = image.slice(0, firstVariable);
	const separator = prefix.lastIndexOf(":");
	if (
		!revision
		|| !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)
		|| separator <= prefix.lastIndexOf("/")
		|| image.includes("@")
	)
		throw new Error("Invalid image tag variables");
	const tag = image.slice(separator + 1).replace(/\$\{([^}]*)\}/g, (_variable, expression: string) => {
		const match = /^COMMIT_ID:([1-9][0-9]*)$/.exec(expression);
		const length = Number(match?.[1]);
		if (!Number.isSafeInteger(length) || length > revision.length) throw new Error("Invalid image tag variables");
		return revision.slice(0, length);
	});
	if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new Error("Invalid image tag variables");
	return image.slice(0, separator + 1) + tag;
}
