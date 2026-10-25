import type { JsonValue } from "@homelab-paas/shared-contracts";

/** Links only recognized Git web hosts; local sources have no browser equivalent. */
export const gitSourceLink = (source: JsonValue, revision?: string): string | undefined => {
	if (!revision || !source || typeof source !== "object" || Array.isArray(source)) return undefined;
	const remote = source["remote"];
	const path = source["descriptorPath"];
	if (typeof remote !== "string" || typeof path !== "string" || !path || path.startsWith("/")) return undefined;
	if (path.split("/").some((part) => part === ".." || part === "." || !part)) return undefined;
	try {
		const url = new URL(remote.replace(/^git@([^:]+):/, "https://$1/"));
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port)
			return undefined;
		const routes: Record<string, string> = { "github.com": "blob", "gitlab.com": "-/blob", "bitbucket.org": "src" };
		const route = routes[url.hostname];
		if (!route || url.pathname.includes("[redacted]")) return undefined;
		const repository = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
		if (repository.split("/").filter(Boolean).length < 2) return undefined;
		return `${url.origin}${repository}/${route}/${encodeURIComponent(revision)}/${path.split("/").map(encodeURIComponent).join("/")}`;
	} catch {
		return undefined;
	}
};
