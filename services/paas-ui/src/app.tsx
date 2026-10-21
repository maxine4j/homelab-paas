import type { UiCluster, UiLogs, UiResource, UiService, UiServiceSummary } from "@homelab-paas/shared-contracts";

import { useApi } from "./hooks/use-api.ts";
import { useRoute } from "./hooks/use-route.ts";
import { ClusterPage } from "./pages/cluster-page.tsx";
import { ResourcePage } from "./pages/resource-page.tsx";
import { ServicePage } from "./pages/service-page.tsx";
import { ServicesPage } from "./pages/services-page.tsx";

export const App = () => {
	const route = useRoute();
	const path =
		route.page === "cluster"
			? "/cluster"
			: route.page === "services"
				? "/services"
				: route.page === "service"
					? `/services/${route.serviceId}`
					: route.page === "resource"
						? `/services/${route.serviceId}/resources/${route.resourceId}`
						: undefined;
	const snapshot = useApi<UiCluster | UiServiceSummary[] | UiService | UiResource>(path);
	const logs = useApi<UiLogs>(
		route.page === "resource" && route.tab === "logs" && route.containerId
			? `${path}/containers/${encodeURIComponent(route.containerId)}/logs`
			: undefined,
	);
	return (
		<div className='app-shell'>
			<aside className='sidebar'>
				<a className='brand' href='#/services'>
					<span className='brand-icon' aria-hidden='true'>
						H
					</span>
					<span>
						homelab<span className='brand-subtitle'>PaaS control plane</span>
					</span>
				</a>
				<nav aria-label='Main navigation'>
					<a href='#/services' aria-current={route.page !== "cluster" ? "page" : undefined}>
						Services <span aria-hidden='true'>↗</span>
					</a>
					<a href='#/cluster' aria-current={route.page === "cluster" ? "page" : undefined}>
						Cluster config <span aria-hidden='true'>⚙</span>
					</a>
				</nav>
				<p className='sidebar-note'>
					Single host. One place.
					<br />
					Read-only management
				</p>
			</aside>
			<div className='workspace'>
				<header className='topbar'>
					<span className='eyebrow'>
						Workspace / {route.page === "cluster" ? "Configuration" : "Services"}
					</span>
					<button
						onClick={() => {
							snapshot.refresh();
							logs.refresh();
						}}
					>
						↻ Refresh
					</button>
				</header>
				<main id='main-content'>
					{snapshot.error ? (
						<div className='empty' role='alert'>
							<h1>Unable to load cluster data</h1>
							<p>{snapshot.error}</p>
							<button onClick={snapshot.refresh}>Retry</button>
						</div>
					) : route.page === "missing" ? (
						<h1>Page not found</h1>
					) : !snapshot.data ? (
						<p role='status' className='empty'>
							Loading cluster data…
						</p>
					) : route.page === "cluster" ? (
						<ClusterPage cluster={snapshot.data as UiCluster} />
					) : route.page === "services" ? (
						<ServicesPage services={snapshot.data as UiServiceSummary[]} />
					) : route.page === "service" ? (
						<ServicePage service={snapshot.data as UiService} />
					) : (
						<ResourcePage
							serviceId={route.serviceId}
							resource={snapshot.data as UiResource}
							tab={route.tab}
							containerId={route.containerId}
							logs={logs.data}
							logError={logs.error}
						/>
					)}
				</main>
				<footer>
					Homelab PaaS <span>Read only · Auto-refresh 5s</span>
				</footer>
			</div>
		</div>
	);
};
