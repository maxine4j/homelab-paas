import type { ServiceDescriptor } from "@homelab-paas/shared-contracts";

// Verify the browser can consume the public descriptor without backend imports.
const descriptor: ServiceDescriptor = {
	version: 1,
	metadata: { serviceId: "example" },
	resources: { app: { type: "web", image: "example:1", ingress: { public: true, port: 8080 } } },
};
// @ts-expect-error Backend deployment state is not part of the descriptor.
descriptor.activeRevision = "commit";
void descriptor;
