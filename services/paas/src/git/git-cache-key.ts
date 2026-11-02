import { createHash } from "node:crypto";

import type { GitFileSource } from "./types.ts";

/** Descriptor identity for memory entries and durable source refs. */
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

/** Shared on-disk identity; branches and descriptor paths share immutable Git objects. */
export const gitRepositoryKey = (source: GitFileSource): string =>
	createHash("sha256")
		.update(JSON.stringify([source.remote, source.accessToken, source.privateKeyPath]))
		.digest("hex");
