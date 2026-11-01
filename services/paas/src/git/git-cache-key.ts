import { createHash } from "node:crypto";

import type { GitFileSource } from "./types.ts";

/** Shared on-disk namespace identity for repository access and garbage collection. */
export const gitCacheKey = (serviceId: string, source: GitFileSource): string =>
	`${serviceId}/${createHash("sha256")
		.update(
			JSON.stringify([
				source.remote,
				source.branch ?? (source.remote === "local" ? "HEAD" : "main"),
				source.descriptorPath,
				source.accessToken,
				source.privateKeyPath,
			]),
		)
		.digest("hex")}`;
