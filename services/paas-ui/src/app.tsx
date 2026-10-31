import type {
	UiCluster,
	UiLogs,
	UiResource,
	UiService,
	UiServiceSummary,
	UiServiceEvent,
} from "@homelab-paas/shared-contracts";

import { GitRefreshControl } from "./components/git-refresh.tsx";
import { ServiceDetailShell } from "./components/service-detail-shell.tsx";
import { useApi } from "./hooks/use-api.ts";
import { useRoute } from "./hooks/use-route.ts";
import { ClusterPage } from "./pages/cluster-page.tsx";
import { ResourceEventsPage } from "./pages/resource-events-page.tsx";
import { ResourcePage } from "./pages/resource-page.tsx";
import { SecretsPage } from "./pages/secrets-page.tsx";
import { ServiceEventsPage } from "./pages/service-events-page.tsx";
import { ServicePage } from "./pages/service-page.tsx";
import { ServicesPage } from "./pages/services-page.tsx";
import type { ApiResult, Route } from "./types.ts";

type Inspection = UiCluster | UiServiceSummary[] | UiService | UiResource;
type ViewResult<T> = ApiResult<T> & { refresh(): void };

export const viewPaths = (route: Route): { snapshot?: string; events?: string } => ({
	snapshot:
		route.page === "cluster"
			? "/cluster"
			: route.page === "services"
				? "/services"
				: route.page === "service" || route.page === "events" || route.page === "secrets"
					? `/services/${route.serviceId}`
					: route.page === "resource"
						? `/services/${route.serviceId}/resources/${route.resourceId}`
						: undefined,
	events:
		route.page === "service"
		|| route.page === "events"
		|| route.page === "resource"
		|| route.page === "resource-events"
			? `/services/${route.serviceId}/events`
			: undefined,
});

export const App = () => {
	const route = useRoute();
	const paths = viewPaths(route);
	const snapshot = useApi<Inspection>(paths.snapshot);
	const containerId =
		route.page === "resource"
			? (route.containerId
				?? (snapshot.data && "containers" in snapshot.data ? snapshot.data.containers.at(0)?.id : undefined))
			: undefined;
	const events = useApi<UiServiceEvent[]>(paths.events);
	const logs = useApi<UiLogs>(
		route.page === "cluster" && route.tab === "logs"
			? "/cluster/logs"
			: route.page === "resource" && route.tab === "logs" && containerId
				? `${paths.snapshot}/containers/${encodeURIComponent(containerId)}/logs`
				: undefined,
	);
	return <AppView route={route} snapshot={snapshot} events={events} logs={logs} containerId={containerId} />;
};

export const AppView = ({
	route,
	snapshot,
	events,
	logs,
	containerId,
}: {
	route: Route;
	snapshot: ViewResult<Inspection>;
	events: ViewResult<UiServiceEvent[]>;
	logs: ApiResult<UiLogs>;
	containerId?: string;
}) => {
	const buildSha = import.meta.env["VITE_BUILD_SHA"] || "unknown";
	const path = viewPaths(route).snapshot;
	const actions =
		route.page === "service" || route.page === "events" || route.page === "secrets" ? (
			<GitRefreshControl
				key={`${route.page}:${route.serviceId}:${route.page === "service" ? (route.tab ?? "overview") : ""}`}
				serviceId={route.serviceId}
				onComplete={() => {
					snapshot.refresh();
					events.refresh();
				}}
			/>
		) : undefined;
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
						Cluster
					</a>
				</nav>
			</header>
			<div className='workspace'>
				<header className='topbar'>
					<nav className='breadcrumbs' aria-label='Breadcrumb'>
						{route.page === "cluster" ? (
							<span aria-current='page'>Cluster</span>
						) : route.page === "missing" ? (
							<span aria-current='page'>Page not found</span>
						) : (
							<>
								<a href='#/services' aria-current={route.page === "services" ? "page" : undefined}>
									Services
								</a>
								{(route.page === "service"
									|| route.page === "resource"
									|| route.page === "events"
									|| route.page === "secrets"
									|| route.page === "resource-events") && (
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
								{(route.page === "resource" || route.page === "resource-events") && (
									<>
										<span aria-hidden='true'>/</span>
										{route.page === "resource-events" ? (
											<a href={`#/services/${route.serviceId}/resources/${route.resourceId}`}>
												{route.resourceId}
											</a>
										) : (
											<span aria-current='page'>{route.resourceId}</span>
										)}
									</>
								)}
								{(route.page === "events"
									|| route.page === "resource-events"
									|| route.page === "secrets") && (
									<>
										<span aria-hidden='true'>/</span>
										<span aria-current='page'>
											{route.page === "secrets" ? "Secrets" : "Events"}
										</span>
									</>
								)}
							</>
						)}
					</nav>
					{route.page === "services" && (
						<GitRefreshControl
							key={path}
							onComplete={() => {
								snapshot.refresh();
								events.refresh();
							}}
						/>
					)}
				</header>
				<main id='main-content'>
					{route.page === "cluster" ? (
						<ClusterPage
							cluster={snapshot.data && "clusterId" in snapshot.data ? snapshot.data : undefined}
							tab={route.tab}
							logs={logs.data}
							logError={logs.error}
							error={snapshot.error}
						/>
					) : route.page === "secrets" ? (
						<SecretsPage
							key={route.serviceId}
							serviceId={route.serviceId}
							service={snapshot.data as UiService | undefined}
							serviceError={snapshot.error}
							actions={actions}
						/>
					) : route.page === "events" ? (
						<ServiceEventsPage
							serviceId={route.serviceId}
							service={snapshot.data as UiService | undefined}
							serviceError={snapshot.error}
							actions={actions}
							events={events.data}
							error={events.error}
						/>
					) : route.page === "resource-events" ? (
						<ResourceEventsPage
							serviceId={route.serviceId}
							resourceId={route.resourceId}
							events={events.data}
							error={events.error}
						/>
					) : route.page === "service" && !snapshot.data ? (
						<ServiceDetailShell
							serviceId={route.serviceId}
							tab={route.tab ?? "overview"}
							serviceError={snapshot.error}
							actions={actions}
						>
							{snapshot.error ? (
								<div className='empty' role='alert'>
									<p>{snapshot.error}</p>
									<button onClick={snapshot.refresh}>Retry</button>
								</div>
							) : (
								<p role='status' className='empty'>
									Loading service data…
								</p>
							)}
						</ServiceDetailShell>
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
					) : route.page === "services" ? (
						<ServicesPage services={snapshot.data as UiServiceSummary[]} />
					) : route.page === "service" ? (
						<ServicePage
							service={snapshot.data as UiService}
							actions={actions}
							tab={route.tab}
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
							events={events.data}
							eventError={events.error}
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
