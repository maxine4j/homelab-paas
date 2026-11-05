import { gitShaSchema } from "@homelab-paas/forge-contracts";

export const commitHref = (projectId: string, search: string, sha: string, mode = "unified", anchor = ""): string => {
	const query = new URLSearchParams(search);
	query.set("view", "commit");
	query.set("commit", sha);
	query.delete("diff");
	if (mode === "split") query.set("diff", "split");
	return `/projects/${projectId}/code?${query}${anchor ? `#${anchor}` : ""}`;
};
export const commitSelection = (
	search: string,
): { kind: "browse" } | { kind: "invalid" } | { kind: "commit"; sha: string; mode: "unified" | "split" } => {
	const query = new URLSearchParams(search);
	if (query.get("view") !== "commit" && !query.has("commit")) return { kind: "browse" };
	const sha = gitShaSchema.safeParse(query.get("commit"));
	const mode = query.get("diff") ?? "unified";
	if (
		query.get("view") !== "commit"
		|| !sha.success
		|| (mode !== "unified" && mode !== "split")
		|| ["view", "commit", "diff"].some((key) => query.getAll(key).length > 1)
	)
		return { kind: "invalid" };
	return { kind: "commit", sha: sha.data, mode };
};
