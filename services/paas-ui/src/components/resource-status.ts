import type { UiResource } from "@homelab-paas/shared-contracts";

/** Aggregate observed container states; this is not an application health probe. */
export const resourceStatus = (resource: UiResource): string => {
	const states = new Set(resource.containers.map((container) => container.state));
	return states.size === 0 ? "missing" : states.size === 1 ? resource.containers[0]!.state : "mixed";
};
