//
/** Public service descriptor contract. The MVP supports one public web resource. */
export interface ServiceDescriptor {
	version: 1;
	metadata: { serviceId: string; description?: string; labels?: Record<string, string> };
	resources: Record<string, WebResource>;
}

export interface WebResource {
	type: "web";
	image: string;
	replicas?: 1;
	rolloutStrategy?: "recreate";
	ingress: { public: true; port: number };
	healthcheckUrl?: string;
	command?: string[];
	env?: { name: string; value: string }[];
	termination?: { timeoutSeconds: number };
}
