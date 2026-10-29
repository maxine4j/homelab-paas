import type {
	UiCluster,
	UiLogs,
	UiResource,
	UiService,
	UiServiceSummary,
	UiServiceEvent,
} from "@homelab-paas/shared-contracts";

import { GitRefreshControl } from "./components/git-refresh.tsx";
import { useApi } from "./hooks/use-api.ts";
import { useRoute } from "./hooks/use-route.ts";
import { ClusterPage } from "./pages/cluster-page.tsx";
import { ResourcePage } from "./pages/resource-page.tsx";
import { ServiceEventsPage } from "./pages/service-events-page.tsx";
import { ServicePage } from "./pages/service-page.tsx";
import { ServicesPage } from "./pages/services-page.tsx";

export const App = () => {
	const buildSha = import.meta.env["VITE_BUILD_SHA"] || "unknown";
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
	const containerId =
		route.page === "resource"
			? (route.containerId
				?? (snapshot.data && "containers" in snapshot.data ? snapshot.data.containers.at(0)?.id : undefined))
			: undefined;
	const events = useApi<UiServiceEvent[]>(
		route.page === "service" || route.page === "events" ? `/services/${route.serviceId}/events` : undefined,
	);
	const logs = useApi<UiLogs>(
		route.page === "resource" && route.tab === "logs" && containerId
			? `${path}/containers/${encodeURIComponent(containerId)}/logs`
			: undefined,
	);
	return (
		<div className='app-shell'>
			<header className='primary-header'>
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
						Services
					</a>
					<a href='#/cluster' aria-current={route.page === "cluster" ? "page" : undefined}>
						Cluster config
					</a>
				</nav>
			</header>
			<div className='workspace'>
				<header className='topbar'>
					<nav className='breadcrumbs' aria-label='Breadcrumb'>
						{route.page === "cluster" ? (
							<span aria-current='page'>Cluster config</span>
						) : route.page === "missing" ? (
							<span aria-current='page'>Page not found</span>
						) : (
							<>
								<a href='#/services' aria-current={route.page === "services" ? "page" : undefined}>
									Services
								</a>
								{(route.page === "service" || route.page === "resource" || route.page === "events") && (
									<>
										<span aria-hidden='true'>/</span>
										<a
											href={`#/services/${route.serviceId}`}
											aria-current={route.page === "service" ? "page" : undefined}
										>
											{route.serviceId}
										</a>
									</>
								)}
								{route.page === "resource" && (
									<>
										<span aria-hidden='true'>/</span>
										<span aria-current='page'>{route.resourceId}</span>
									</>
								)}
								{route.page === "events" && (
									<>
										<span aria-hidden='true'>/</span>
										<span aria-current='page'>Events</span>
									</>
								)}
							</>
						)}
					</nav>
					<button
						onClick={() => {
							snapshot.refresh();
							logs.refresh();
							events.refresh();
						}}
					>
						↻ Refresh snapshot
					</button>
				</header>
				<main id='main-content'>
					{(route.page === "services" || route.page === "service") && (
						<GitRefreshControl
							key={path}
							serviceId={route.page === "service" ? route.serviceId : undefined}
							onComplete={() => {
								snapshot.refresh();
								events.refresh();
							}}
						/>
					)}
					{route.page === "events" ? (
						<ServiceEventsPage serviceId={route.serviceId} events={events.data} error={events.error} />
					) : snapshot.error ? (
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
						<ServicePage
							service={snapshot.data as UiService}
							events={events.data}
							eventError={events.error}
						/>
					) : (
						<ResourcePage
							serviceId={route.serviceId}
							resource={snapshot.data as UiResource}
							tab={route.tab}
							containerId={containerId}
							logs={logs.data}
							logError={logs.error}
						/>
					)}
				</main>
				<footer>
					<span title={buildSha}>Build {buildSha.slice(0, 7)}</span>
					<span aria-live='polite'>
						{import.meta.env.MODE === "mock"
							? "Mock snapshots"
							: snapshot.connected || events.connected
								? "Live · connected"
								: "Live · reconnecting…"}
					</span>
				</footer>
			</div>
		</div>
	);
};
