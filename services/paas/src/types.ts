import type { GitHubEndpoints } from "./ingress/auth/oauth-provider/types.ts";

/** Composition overrides; never loaded from public platform configuration. */
export interface StartOptions {
	githubEndpoints?: GitHubEndpoints;
}
