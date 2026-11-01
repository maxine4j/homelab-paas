/** Domain templates apply only to literal workload environment values, never secrets. */
export const resolveDomainTemplate = (
	value: string,
	serviceId: string,
	resourceId: string,
	baseDomain?: string,
): string => {
	if (!value.includes("${")) return value;
	if (!baseDomain) throw new Error("Domain templates require the configured base domain");
	const domains: Record<string, string> = {
		BASE_DOMAIN: baseDomain,
		SERVICE_DOMAIN: `${serviceId}.${baseDomain}`,
		RESOURCE_DOMAIN: `${resourceId}.${serviceId}.${baseDomain}`,
	};
	const expanded = value.replace(/\$\{([^}]*)\}/g, (_match, name: string) => {
		if (!Object.hasOwn(domains, name)) throw new Error("Invalid environment domain template");
		return domains[name]!;
	});
	if (expanded.includes("${")) throw new Error("Invalid environment domain template");
	return expanded;
};
