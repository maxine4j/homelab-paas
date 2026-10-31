import { useSyncExternalStore } from "react";

import type { Route } from "../types.ts";

export const parseRoute = (hash: string): Route => {
	const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
	if (parts.length === 0 || (parts.length === 1 && parts.at(0) === "services")) return { page: "services" };
	if (parts.length === 1 && parts.at(0) === "cluster") return { page: "cluster" };
	const serviceId = parts.at(1);
	const resourceId = parts.at(3);
	const id = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
	if (parts.at(0) !== "services" || !serviceId || !id.test(serviceId)) return { page: "missing" };
	if (parts.length === 2) return { page: "service", serviceId };
	if (parts.length === 3 && parts.at(2) === "events") return { page: "events", serviceId };
	if (parts.at(2) !== "resources" || !resourceId || !id.test(resourceId)) return { page: "missing" };
	const tab = parts.at(4) ?? "config";
	if (parts.length === 5 && tab === "events") return { page: "resource-events", serviceId, resourceId };
	if (!["config", "state", "logs"].includes(tab) || parts.length > 6 || (parts.length === 6 && tab !== "logs"))
		return { page: "missing" };
	return {
		page: "resource",
		serviceId,
		resourceId,
		tab: tab === "logs" ? "logs" : "config",
		...(parts.at(5) ? { containerId: parts.at(5) } : {}),
	};
};

const subscribe = (notify: () => void) => {
	window.addEventListener("hashchange", notify);
	return () => window.removeEventListener("hashchange", notify);
};
export const useRoute = (): Route =>
	parseRoute(
		useSyncExternalStore(
			subscribe,
			() => window.location.hash,
			() => "",
		),
	);
