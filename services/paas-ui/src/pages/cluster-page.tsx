import type { UiCluster, UiLogs } from "@homelab-paas/shared-contracts";

import { ConfigEditor } from "../components/config-editor.tsx";
import { ContainerLogs } from "../components/container-logs.tsx";
import { DetailTabs } from "../components/detail-tabs.tsx";

export const ClusterPage = ({
	cluster,
	tab = "config",
	logs,
	logError,
	error,
}: {
	cluster?: UiCluster;
	tab?: "config" | "logs" | "ingress-logs";
	logs?: UiLogs;
	logError?: string;
	error?: string;
}) => (
	<>
		<div className='page-heading'>
			<div>
				<h1>Cluster</h1>
			</div>
		</div>
		<DetailTabs
			base='#/cluster'
			label='Cluster detail'
			current={tab === "config" ? "" : `/${tab}`}
			tabs={[
				{ path: "", label: "Config" },
				{ path: "/logs", label: "PaaS logs" },
				{ path: "/ingress-logs", label: "Ingress logs" },
			]}
		/>
		{tab !== "config" ? (
			<section aria-label={tab === "logs" ? "PaaS logs" : "Ingress logs"}>
				<h2>{tab === "logs" ? "PaaS logs" : "Ingress logs"}</h2>
				{logError ? (
					<p role='alert'>{logError}</p>
				) : (
					<ContainerLogs key={logs?.containerId} content={logs?.content} />
				)}
			</section>
		) : cluster ? (
			<>
				<p>Save live settings to the host configuration. Credentials remain private.</p>
				<section aria-label='Cluster details'>
					<dl className='summary'>
						<div>
							<dt>Cluster ID</dt>
							<dd>{cluster.clusterId}</dd>
						</div>
						{[
							["Base domain", "ingress.baseDomain"],
							["HTTP port", "ingress.httpPort"],
							["HTTPS port", "ingress.httpsPort"],
						].map(([label, path]) => (
							<div key={path}>
								<dt>{label}</dt>
								<dd>
									{String(
										cluster.fields.find((field) => field.path === path)?.value
											?? (path === "ingress.httpsPort" ? "Not configured" : "Unavailable"),
									)}
								</dd>
							</div>
						))}
					</dl>
				</section>
				<ConfigEditor snapshot={cluster} />
			</>
		) : (
			<p role={error ? "alert" : "status"}>{error ?? "Loading cluster data…"}</p>
		)}
	</>
);
